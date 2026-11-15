from datetime import timedelta

from app.core.passwords import sha256
from app.core.timeutil import now


def _invite(owner, hid, email, role="family_member"):
    return owner.post(f"/api/households/{hid}/invitations", json={"email": email, "role": role})


def test_token_returned_once_and_only_hash_stored(make_actor, store):
    owner = make_actor("Owner")
    hid = owner.create_household()
    r = _invite(owner, hid, "guest@example.com")
    token = r.json()["token"]
    assert store.get(f"invitations/{token}") is None
    assert store.get(f"invitations/{sha256(token)}") is not None
    listed = owner.get(f"/api/households/{hid}/invitations").json()
    assert listed[0]["token"] is None and listed[0]["status"] == "pending"


def test_invitation_bound_to_email(make_actor):
    owner, invited, other = make_actor("Owner"), make_actor("Invited"), make_actor("Other")
    hid = owner.create_household()
    token = _invite(owner, hid, invited.email).json()["token"]
    assert other.get(f"/api/invitations/{token}").status_code == 404
    assert other.post(f"/api/invitations/{token}/accept").status_code == 404
    assert invited.get(f"/api/invitations/{token}").json()["householdName"] == "Sharma Family"
    assert invited.post(f"/api/invitations/{token}/accept").status_code == 200
    assert invited.post(f"/api/invitations/{token}/accept").status_code == 409  # single use


def test_pending_invitations_listed_for_invitee_and_acceptable_by_id(make_actor):
    owner, invited = make_actor("Owner"), make_actor("Invited")
    hid = owner.create_household()
    _invite(owner, hid, invited.email.upper())  # case-insensitive match
    mine = invited.get("/api/me/invitations").json()
    assert len(mine) == 1 and mine[0]["token"] is None
    assert invited.post(f"/api/me/invitations/{mine[0]['id']}/accept").status_code == 200
    assert invited.get("/api/me/invitations").json() == []
    assert owner.get(f"/api/households/{hid}").json()["memberCount"] == 2


def test_revoked_and_expired_invitations_cannot_be_used(make_actor, store):
    owner, a, b = make_actor("Owner"), make_actor("A"), make_actor("B")
    hid = owner.create_household()
    ra = _invite(owner, hid, a.email).json()
    assert owner.delete(f"/api/households/{hid}/invitations/{ra['id']}").status_code == 204
    assert a.post(f"/api/invitations/{ra['token']}/accept").status_code == 409
    rb = _invite(owner, hid, b.email).json()
    store.update(f"invitations/{rb['id']}", {"expiresAt": now() - timedelta(seconds=1)})
    assert b.post(f"/api/invitations/{rb['token']}/accept").status_code == 409


def test_reinvite_supersedes_previous_and_existing_member_conflict(make_actor):
    owner, a = make_actor("Owner"), make_actor("A")
    hid = owner.create_household()
    first = _invite(owner, hid, a.email).json()
    second = _invite(owner, hid, a.email).json()
    assert a.post(f"/api/invitations/{first['token']}/accept").status_code == 409
    assert a.post(f"/api/invitations/{second['token']}/accept").status_code == 200
    assert _invite(owner, hid, a.email).status_code == 409
    assert _invite(owner, hid, owner.email).status_code == 422


def test_invitation_carries_temporary_access(make_actor):
    owner, a = make_actor("Owner"), make_actor("A")
    hid = owner.create_household()
    exp = (now() + timedelta(days=2)).isoformat()
    r = owner.post(f"/api/households/{hid}/invitations",
                   json={"email": a.email, "role": "secondary_caregiver", "accessExpiresAt": exp})
    a.post(f"/api/invitations/{r.json()['token']}/accept")
    member = next(m for m in owner.get(f"/api/households/{hid}/members").json() if m["uid"] == a.uid)
    assert member["expiresAt"] is not None
