"""ENGINE 3 — Family Coordination Intelligence: contribution & workload, balancer, consolidated
overview (Universal Care Switcher) and cross-household Responsibility Centre.

Fairness principle: this measures WORKLOAD, never commitment or affection. Members are listed
alphabetically, not ranked.
"""
from __future__ import annotations

from datetime import timedelta
from statistics import mean

from ..core.auth import CurrentUser
from ..core.rbac import P, ROLE_PERMISSIONS, Role
from ..core.timeutil import aware, now
from ..db import Store
from .access import Access, active_members, member_can_see
from .handovers import is_absent
from .tasks import OPEN_STATES, task_out
from .users import memberships_for


def _load_by_member(store: Store, acc: Access, days: int) -> tuple[dict, list]:
    hid, t = acc.hid, now()
    since = t - timedelta(days=days)
    members = [m for m in active_members(store, hid) if m["role"] != "senior"]
    rows = {m["uid"]: {"uid": m["uid"], "displayName": m["displayName"], "role": m["role"],
                       "canTakeTasks": P.TASKS_UPDATE_ASSIGNED in ROLE_PERMISSIONS[Role(m["role"])],
                       "assignedPending": 0, "accepted": 0, "completed": 0, "overdue": 0, "escortUpcoming": 0,
                       "dosesRecorded": 0, "handoversWritten": 0, "unavailableNow": is_absent(store, hid, m["uid"], t, t + timedelta(hours=1))}
            for m in members}
    tasks = []
    for d in store.query(f"households/{hid}/tasks"):
        x = d.data
        sid = x.get("seniorId")
        if sid and not acc.can_see(sid):
            continue
        tasks.append((d.id, x))
        r = rows.get(x.get("assigneeUid"))
        if x["status"] in OPEN_STATES and x["status"] != "open":
            if r:
                r["assignedPending" if x["status"] == "assigned" else "accepted"] += 1
                due = aware(x.get("dueAt"))
                if due and due < t:
                    r["overdue"] += 1
        if x["status"] == "done" and aware(x.get("completedAt")) and aware(x["completedAt"]) >= since:
            done_by = rows.get(x.get("completedBy"))
            if done_by:
                done_by["completed"] += 1
    for sid in acc.visible_senior_ids():
        if acc.allowed(sid, "appointments"):
            for a in store.query(f"households/{hid}/seniors/{sid}/appointments"):
                r = rows.get(a.data.get("escortUid"))
                if r and a.data["status"] == "scheduled" and aware(a.data["startsAt"]) >= t:
                    r["escortUpcoming"] += 1
        if acc.allowed(sid, "medications"):
            for e in store.query(f"households/{hid}/seniors/{sid}/doseEvents"):
                r = rows.get(e.data.get("recordedBy"))
                if r and aware(e.data["recordedAt"]) >= since:
                    r["dosesRecorded"] += 1
    for h in store.query(f"households/{hid}/handovers"):
        r = rows.get(h.data["fromUid"])
        if r and aware(h.data["createdAt"]) >= since:
            r["handoversWritten"] += 1
    for r in rows.values():
        r["currentLoad"] = r["assignedPending"] + r["accepted"] + r["escortUpcoming"]
    return rows, tasks


def contribution(store: Store, actor: CurrentUser, hid: str, days: int = 30) -> dict:
    acc = Access(store, actor.uid, hid, P.TASKS_READ)
    rows, tasks = _load_by_member(store, acc, days)
    full = acc.can(P.TASKS_MANAGE) or acc.can(P.MEMBERS_MANAGE)
    eligible = [r for r in rows.values() if r["canTakeTasks"] and not r["unavailableNow"]]
    avg = mean([r["currentLoad"] for r in eligible]) if eligible else 0
    for r in rows.values():
        r["imbalanced"] = bool(r["canTakeTasks"] and r["currentLoad"] >= 3 and r["currentLoad"] >= 1.5 * max(avg, 1))
    unassigned = sum(1 for _, x in tasks if x["status"] == "open")
    visible_rows = sorted(rows.values(), key=lambda r: r["displayName"].lower())
    if not full:
        visible_rows = [r for r in visible_rows if r["uid"] == actor.uid]
    return {"windowDays": days, "members": visible_rows, "unassignedTasks": unassigned,
            "averageLoad": round(avg, 2), "fullView": full,
            "suggestions": balance_suggestions(store, acc, rows, tasks, avg) if full else [],
            "principle": "This view shows workload to help share care fairly. It does not measure anyone's commitment."}


def balance_suggestions(store: Store, acc: Access, rows: dict, tasks: list, avg: float) -> list[dict]:
    """Caregiver Workload Balancer: propose moving not-yet-started work from overloaded members to the
    least-loaded eligible member who can see the same profile. Suggestions only — applying one is an
    explicit, audited reassignment by a coordinator."""
    hid = acc.hid
    load = {u: r["currentLoad"] for u, r in rows.items()}
    members = {m["uid"]: m for m in active_members(store, hid)}
    out = []
    for uid, r in sorted(rows.items(), key=lambda kv: -kv[1]["currentLoad"]):
        if not r["imbalanced"]:
            continue
        movable = sorted([(tid, x) for tid, x in tasks if x.get("assigneeUid") == uid and x["status"] in ("assigned", "accepted")],
                         key=lambda tx: (tx[1]["status"] != "assigned", aware(tx[1].get("dueAt")) or now() + timedelta(days=365)))
        for tid, x in movable:
            if load[uid] <= max(avg, 1):
                break
            sid = x.get("seniorId")
            cands = [c for c, cr in rows.items()
                     if c != uid and cr["canTakeTasks"] and not cr["unavailableNow"]
                     and (not sid or member_can_see(store, hid, members[c], sid)) and load[c] + 1 < load[uid]]
            if not cands:
                continue
            to = min(cands, key=lambda c: (load[c], rows[c]["displayName"].lower()))
            out.append({"taskId": tid, "taskTitle": task_out(acc, tid, x)["title"], "fromUid": uid,
                        "fromName": r["displayName"], "toUid": to, "toName": rows[to]["displayName"],
                        "reason": f"{r['displayName']} has {load[uid]} active responsibilities; "
                                  f"{rows[to]['displayName']} has {load[to]}."})
            load[uid] -= 1
            load[to] += 1
    return out


def overview(store: Store, actor: CurrentUser) -> list[dict]:
    """Consolidated cross-household overview: counts only, no medical details."""
    from .continuity import detect_gaps

    out = []
    t = now()
    for m in memberships_for(store, actor.uid):
        hid = m.household_id
        h = store.get(f"households/{hid}")
        if not h:
            continue
        acc = Access(store, actor.uid, hid)
        sids = acc.visible_senior_ids()
        my_open = unassigned = 0
        for d in store.query(f"households/{hid}/tasks"):
            x = d.data
            if x.get("seniorId") and not acc.can_see(x["seniorId"]):
                continue
            if x.get("assigneeUid") == actor.uid and x["status"] in ("assigned", "accepted"):
                my_open += 1
            if x["status"] == "open":
                unassigned += 1
        upcoming = 0
        if acc.can(P.SENIOR_MEDICAL_READ):
            for sid in sids:
                if acc.allowed(sid, "appointments"):
                    upcoming += sum(1 for a in store.query(f"households/{hid}/seniors/{sid}/appointments")
                                    if a.data["status"] == "scheduled" and t <= aware(a.data["startsAt"]) <= t + timedelta(days=7))
        gaps = detect_gaps(store, actor, hid)["counts"] if acc.can(P.TASKS_READ) else None
        out.append({"householdId": hid, "householdName": h.data["name"], "role": m.role.value, "profiles": len(sids),
                    "myOpenTasks": my_open, "unassignedTasks": unassigned, "appointmentsNext7Days": upcoming,
                    "gaps": gaps})
    return sorted(out, key=lambda x: x["householdName"].lower())


def responsibilities(store: Store, actor: CurrentUser) -> dict:
    """Care Responsibility Centre across every household — scoped and redacted per household."""
    t = now()
    mine, claimable, escorts, handovers, covers = [], [], [], [], []
    for m in memberships_for(store, actor.uid):
        hid = m.household_id
        h = store.get(f"households/{hid}")
        if not h:
            continue
        acc = Access(store, actor.uid, hid)
        hname = h.data["name"]
        for d in store.query(f"households/{hid}/tasks"):
            x = d.data
            sid = x.get("seniorId")
            if x["status"] not in OPEN_STATES or (sid and not acc.can_see(sid)):
                continue
            item = {**task_out(acc, d.id, x), "householdName": hname}
            if x.get("assigneeUid") == actor.uid:
                mine.append(item)
            elif x["status"] == "open" and acc.can(P.TASKS_UPDATE_ASSIGNED):
                claimable.append(item)
        for sid in acc.visible_senior_ids():
            if not acc.allowed(sid, "appointments"):
                continue
            for a in store.query(f"households/{hid}/seniors/{sid}/appointments"):
                x = a.data
                if x["status"] == "scheduled" and aware(x["startsAt"]) >= t - timedelta(hours=2) and \
                        (x.get("escortUid") == actor.uid or (not x.get("escortUid") and acc.can(P.TASKS_UPDATE_ASSIGNED) and m.role != Role.SENIOR)):
                    escorts.append({"id": a.id, "householdId": hid, "householdName": hname, "seniorId": sid,
                                    "seniorName": acc.senior(sid)["fullName"], "title": x["title"],  # type: ignore[index]
                                    "startsAt": x["startsAt"], "location": x.get("location"),
                                    "escortAccepted": x.get("escortAccepted"), "mine": x.get("escortUid") == actor.uid})
        for d in store.query(f"households/{hid}/handovers"):
            x = d.data
            if x["toUid"] == actor.uid and x["status"] == "pending":
                handovers.append({"id": d.id, "householdId": hid, "householdName": hname, "fromName": x["fromName"],
                                  "createdAt": x["createdAt"]})
        for d in store.query(f"households/{hid}/absences"):
            x = d.data
            if x["status"] != "active" or aware(x["endsAt"]) < t:
                continue
            for it in x["items"]:
                if not it["coveredBy"] and actor.uid in [c["uid"] for c in x["candidates"].get(it["id"], [])]:
                    if it.get("seniorId") and not acc.can_see(it["seniorId"]):
                        continue
                    covers.append({"absenceId": d.id, "householdId": hid, "householdName": hname, "absentName": x["name"],
                                   "itemType": it["type"], "itemId": it["id"], "title": it["title"], "dueAt": it.get("dueAt")})
    key = lambda i: (aware(i.get("dueAt")) is None, aware(i.get("dueAt")) or t)  # noqa: E731
    return {"myTasks": sorted(mine, key=key), "claimable": sorted(claimable, key=key),
            "escorts": sorted(escorts, key=lambda e: e["startsAt"]), "handoversToAcknowledge": handovers,
            "coverRequests": covers}
