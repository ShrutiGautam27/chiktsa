"""Multi-tenant isolation and the scenarios required by the product brief."""


def test_household_creation_makes_creator_owner(make_actor):
    owner = make_actor("Ravi")
    hid = owner.create_household()
    me = owner.get("/api/me").json()
    assert me["memberships"][0]["householdId"] == hid
    assert me["memberships"][0]["role"] == "household_owner"
    assert owner.get(f"/api/households/{hid}").json()["memberCount"] == 1


def test_scenario_a_two_seniors_have_independent_profiles(make_actor):
    """Scenario A (foundation): one family, two elderly individuals with separate records."""
    owner = make_actor("Ravi")
    hid = owner.create_household()
    g = owner.add_senior(hid, "Grandfather Mohan")
    m = owner.add_senior(hid, "Grandmother Kamla")
    u = owner.add_senior(hid, "Uncle Suresh")
    seniors = owner.get(f"/api/households/{hid}/seniors").json()
    assert {s["id"] for s in seniors} == {g, m, u}
    assert owner.get(f"/api/households/{hid}").json()["seniorCount"] == 3
    owner.patch(f"/api/households/{hid}/seniors/{g}", json={"notes": "Prefers mornings"})
    assert owner.get(f"/api/households/{hid}/seniors/{m}").json()["notes"] == ""
    # Per-profile audit history is separate
    g_log = owner.get(f"/api/households/{hid}/audit", params={"seniorId": g}).json()
    assert g_log and all(e["seniorId"] == g for e in g_log)


def test_scenario_b_user_in_two_households(make_actor):
    a_owner, b_owner, priya = make_actor("A"), make_actor("B"), make_actor("Priya")
    ha, hb = a_owner.create_household("Household A"), b_owner.create_household("Household B")
    a_owner.add_senior(ha, "Grandfather A")
    b_owner.add_senior(hb, "Grandmother B")
    a_owner.invite(ha, priya, "family_member")
    b_owner.invite(hb, priya, "family_admin")
    roles = {m["householdId"]: m["role"] for m in priya.get("/api/me").json()["memberships"]}
    assert roles == {ha: "family_member", hb: "family_admin"}
    assert {h["id"] for h in priya.get("/api/households").json()} == {ha, hb}
    # Role in one household doesn't carry over: member in A cannot add a senior, admin in B can
    assert priya.post(f"/api/households/{ha}/seniors", json={"fullName": "X"}).status_code == 403
    assert priya.post(f"/api/households/{hb}/seniors", json={"fullName": "Y"}).status_code == 201


def test_scenario_c_caregiver_serves_multiple_households_with_scoped_access(make_actor):
    a, b, cg = make_actor("OwnerA"), make_actor("OwnerB"), make_actor("Carer")
    ha, hb = a.create_household("A"), b.create_household("B")
    a1, a2 = a.add_senior(ha, "A-One"), a.add_senior(ha, "A-Two")
    b1 = b.add_senior(hb, "B-One")
    a.invite(ha, cg, "primary_caregiver", scope=[a1])     # only one of two seniors
    b.invite(hb, cg, "secondary_caregiver")               # whole household
    assert [s["id"] for s in cg.get(f"/api/households/{ha}/seniors").json()] == [a1]
    assert cg.get(f"/api/households/{ha}/seniors/{a2}").status_code == 404
    assert cg.get(f"/api/households/{ha}/seniors/{a1}").status_code == 200
    assert [s["id"] for s in cg.get(f"/api/households/{hb}/seniors").json()] == [b1]


def test_scenario_f_unauthorised_user_denied_everywhere(make_actor):
    owner, intruder = make_actor("Owner"), make_actor("Intruder")
    hid = owner.create_household()
    sid = owner.add_senior(hid, "Grandfather")
    base = f"/api/households/{hid}"
    probes = [
        intruder.get(base), intruder.get(f"{base}/seniors"), intruder.get(f"{base}/seniors/{sid}"),
        intruder.get(f"{base}/members"), intruder.get(f"{base}/audit"), intruder.get(f"{base}/invitations"),
        intruder.patch(base, json={"name": "pwned"}),
        intruder.patch(f"{base}/seniors/{sid}", json={"notes": "pwned"}),
        intruder.delete(f"{base}/seniors/{sid}"),
        intruder.post(f"{base}/seniors", json={"fullName": "Fake"}),
        intruder.post(f"{base}/invitations", json={"email": "x@example.com", "role": "family_member"}),
        intruder.delete(f"{base}/members/{owner.uid}"),
    ]
    # Non-members get 404 for everything: the household's existence is not disclosed.
    assert [p.status_code for p in probes] == [404] * len(probes)
    assert intruder.get("/api/households").json() == []
    assert owner.get(f"{base}/seniors/{sid}").json()["notes"] == ""


def test_revoked_member_loses_access_immediately(make_actor):
    owner, member = make_actor("Owner"), make_actor("Member")
    hid = owner.create_household()
    sid = owner.add_senior(hid, "Grandmother")
    owner.invite(hid, member, "family_member")
    assert member.get(f"/api/households/{hid}/seniors/{sid}").status_code == 200
    assert owner.delete(f"/api/households/{hid}/members/{member.uid}").status_code == 204
    assert member.get(f"/api/households/{hid}/seniors/{sid}").status_code == 404
    assert member.get("/api/households").json() == []
    assert owner.get(f"/api/households/{hid}").json()["memberCount"] == 1


def test_temporary_access_expires(make_actor, store):
    from datetime import timedelta

    from app.core.timeutil import now

    owner, temp = make_actor("Owner"), make_actor("Temp")
    hid = owner.create_household()
    owner.invite(hid, temp, "secondary_caregiver")
    future = (now() + timedelta(days=1)).isoformat()
    assert owner.patch(f"/api/households/{hid}/members/{temp.uid}", json={"expiresAt": future}).status_code == 200
    assert temp.get(f"/api/households/{hid}").status_code == 200
    # Simulate time passing by moving expiry into the past directly in the store
    store.update(f"households/{hid}/members/{temp.uid}", {"expiresAt": now() - timedelta(minutes=1)})
    assert temp.get(f"/api/households/{hid}").status_code == 404
    past = (now() - timedelta(days=1)).isoformat()
    assert owner.patch(f"/api/households/{hid}/members/{temp.uid}", json={"expiresAt": past}).status_code == 422


def test_archived_senior_hidden_but_history_kept(make_actor, store):
    owner = make_actor("Owner")
    hid = owner.create_household()
    sid = owner.add_senior(hid, "Grandfather")
    assert owner.delete(f"/api/households/{hid}/seniors/{sid}").status_code == 204
    assert owner.get(f"/api/households/{hid}/seniors").json() == []
    assert len(owner.get(f"/api/households/{hid}/seniors", params={"includeArchived": True}).json()) == 1
    assert store.get(f"households/{hid}/seniors/{sid}") is not None  # never hard-deleted
    actions = [e["action"] for e in owner.get(f"/api/households/{hid}/audit").json()]
    assert "senior.archive" in actions and "senior.create" in actions
