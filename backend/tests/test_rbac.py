"""Role-based permissions and invitation rules."""
import pytest

from app.core.rbac import ROLE_PERMISSIONS, P, Role


def test_platform_admin_has_no_implicit_household_access(make_actor, store):
    owner, admin = make_actor("Owner"), make_actor("Admin")
    store.update(f"users/{admin.uid}", {"platformRole": "platform_admin"})
    hid = owner.create_household()
    assert admin.get(f"/api/households/{hid}").status_code == 404


def test_role_matrix_sanity():
    assert P.MEMBERS_MANAGE not in ROLE_PERMISSIONS[Role.FAMILY_MEMBER]
    assert P.MEDS_VERIFY not in ROLE_PERMISSIONS[Role.SECONDARY_CAREGIVER]
    assert P.MEDS_VERIFY in ROLE_PERMISSIONS[Role.PRIMARY_CAREGIVER]
    assert P.CONSENT_MANAGE in ROLE_PERMISSIONS[Role.SENIOR]
    assert P.SENIORS_MANAGE not in ROLE_PERMISSIONS[Role.SENIOR]


@pytest.mark.parametrize("role,can_add_senior,can_invite,can_read_audit", [
    ("family_admin", True, True, True),
    ("family_member", False, False, False),
    ("primary_caregiver", False, False, False),
    ("secondary_caregiver", False, False, False),
    ("org_admin", False, False, True),
])
def test_permissions_by_role(make_actor, role, can_add_senior, can_invite, can_read_audit):
    owner, user, other = make_actor("Owner"), make_actor("User"), make_actor("Other")
    hid = owner.create_household()
    owner.add_senior(hid, "Grandfather")
    owner.invite(hid, user, role)
    add = user.post(f"/api/households/{hid}/seniors", json={"fullName": "New"})
    inv = user.post(f"/api/households/{hid}/invitations", json={"email": other.email, "role": "family_member"})
    aud = user.get(f"/api/households/{hid}/audit")
    assert (add.status_code == 201) == can_add_senior
    assert (inv.status_code == 201) == can_invite
    assert (aud.status_code == 200) == can_read_audit
    for r in (add, inv, aud):
        assert r.status_code in (200, 201, 403)


def test_senior_role_sees_only_own_profile(make_actor):
    owner, grandpa = make_actor("Owner"), make_actor("Grandpa")
    hid = owner.create_household()
    g = owner.add_senior(hid, "Grandfather")
    m = owner.add_senior(hid, "Grandmother")
    owner.invite(hid, grandpa, "senior", linked=g)
    assert [s["id"] for s in grandpa.get(f"/api/households/{hid}/seniors").json()] == [g]
    assert grandpa.get(f"/api/households/{hid}/seniors/{m}").status_code == 404
    assert grandpa.patch(f"/api/households/{hid}/seniors/{g}", json={"notes": "x"}).status_code == 403
    me = grandpa.get("/api/me").json()["memberships"][0]
    assert me["role"] == "senior" and me["seniorScope"] == [g]


def test_senior_invitation_requires_linked_profile(make_actor):
    owner, x = make_actor("Owner"), make_actor("X")
    hid = owner.create_household()
    r = owner.post(f"/api/households/{hid}/invitations", json={"email": x.email, "role": "senior"})
    assert r.status_code == 422


def test_owner_cannot_be_granted_modified_or_removed(make_actor):
    owner, admin, x = make_actor("Owner"), make_actor("Admin"), make_actor("X")
    hid = owner.create_household()
    owner.invite(hid, admin, "family_admin")
    assert owner.post(f"/api/households/{hid}/invitations",
                      json={"email": x.email, "role": "household_owner"}).status_code == 422
    assert admin.delete(f"/api/households/{hid}/members/{owner.uid}").status_code == 403
    assert admin.patch(f"/api/households/{hid}/members/{owner.uid}",
                       json={"role": "family_member"}).status_code == 403
    assert owner.delete(f"/api/households/{hid}/members/{owner.uid}").status_code == 409  # owner can't leave


def test_admin_cannot_escalate_or_manage_peer_admins(make_actor):
    owner, admin1, admin2, member = make_actor("O"), make_actor("A1"), make_actor("A2"), make_actor("M")
    hid = owner.create_household()
    owner.invite(hid, admin1, "family_admin")
    owner.invite(hid, admin2, "family_admin")
    admin1.invite(hid, member, "family_member")
    # admin cannot promote to admin, nor demote/remove another admin, nor edit self
    assert admin1.patch(f"/api/households/{hid}/members/{member.uid}", json={"role": "family_admin"}).status_code == 403
    assert admin1.delete(f"/api/households/{hid}/members/{admin2.uid}").status_code == 403
    assert admin1.patch(f"/api/households/{hid}/members/{admin1.uid}", json={"role": "family_member"}).status_code == 403
    # but can change a member to caregiver
    r = admin1.patch(f"/api/households/{hid}/members/{member.uid}", json={"role": "primary_caregiver"})
    assert r.status_code == 200 and r.json()["role"] == "primary_caregiver"


def test_scope_changes_are_validated_and_audited(make_actor):
    owner, cg = make_actor("Owner"), make_actor("Carer")
    hid = owner.create_household()
    a, b = owner.add_senior(hid, "A"), owner.add_senior(hid, "B")
    owner.invite(hid, cg, "primary_caregiver", scope=[a])
    assert owner.patch(f"/api/households/{hid}/members/{cg.uid}", json={"seniorScope": ["nope"]}).status_code == 422
    assert owner.patch(f"/api/households/{hid}/members/{cg.uid}", json={"seniorScope": [a, b]}).status_code == 200
    assert len(cg.get(f"/api/households/{hid}/seniors").json()) == 2
    log = owner.get(f"/api/households/{hid}/audit").json()[0]
    assert log["action"] == "member.update" and log["changes"]["seniorScope"]["to"] == sorted([a, b])


def test_scoped_caregiver_cannot_manage_household(make_actor):
    owner, cg = make_actor("Owner"), make_actor("Carer")
    hid = owner.create_household()
    a = owner.add_senior(hid, "A")
    owner.invite(hid, cg, "primary_caregiver", scope=[a])
    assert cg.patch(f"/api/households/{hid}", json={"name": "x"}).status_code == 403
