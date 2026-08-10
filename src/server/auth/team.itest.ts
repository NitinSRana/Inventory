import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

import { claimInvitation, orgForUser } from '@/db/tenant';
import {
  LastOwnerError,
  changeMemberRole,
  inviteMember,
  listMembers,
  listPendingInvitations,
  removeMember,
  revokeInvitation,
} from '@/server/auth/team';
import { adminSql, createTestOrg, type TestOrg } from '@/server/testing/fixtures';

describe('invitations', () => {
  let org: TestOrg;
  let rival: TestOrg;

  before(async () => {
    org = await createTestOrg('Team Test');
    rival = await createTestOrg('Team Rival');
  });

  test('an invitation is recorded without creating an auth user', async () => {
    await inviteMember(org.orgId, { email: 'Anna@Store.example', role: 'staff', invitedBy: org.userId });
    const pending = await listPendingInvitations(org.orgId);
    assert.equal(pending.length, 1);
    // Folded on write, so the later case-insensitive match is not a coincidence.
    assert.equal(pending[0].email, 'anna@store.example');
    assert.equal(pending[0].role, 'staff');
  });

  test('re-inviting corrects the role instead of colliding', async () => {
    await inviteMember(org.orgId, { email: 'anna@store.example', role: 'manager' });
    const pending = await listPendingInvitations(org.orgId);
    assert.equal(pending.length, 1, 'an owner fixing a typo must not have to revoke first');
    assert.equal(pending[0].role, 'manager');
  });

  test('someone else signing in claims nothing', async () => {
    const stranger = crypto.randomUUID();
    assert.equal(await claimInvitation(stranger, 'someone.else@example.com'), null);
    assert.equal(await orgForUser(stranger), null);
  });

  test('the invitee joins on first sign-in, matched case-insensitively', async () => {
    const anna = crypto.randomUUID();
    assert.equal(await claimInvitation(anna, 'ANNA@Store.Example'), org.orgId);

    const members = await listMembers(org.orgId);
    const joined = members.find((m) => m.userId === anna)!;
    assert.equal(joined.role, 'manager', 'the corrected role is the one that applies');
    assert.equal(await orgForUser(anna), org.orgId);
    assert.equal((await listPendingInvitations(org.orgId)).length, 0);
  });

  test('claiming twice is a no-op, not a second membership', async () => {
    const [row] = await adminSql`
      select accepted_by from organization_invitations where organization_id = ${org.orgId} limit 1`;
    assert.equal(await claimInvitation(row.accepted_by, 'anna@store.example'), null);
    assert.equal((await listMembers(org.orgId)).length, 2);
  });

  test('a revoked invitation cannot be claimed', async () => {
    await inviteMember(org.orgId, { email: 'never@store.example', role: 'staff' });
    const [invite] = await listPendingInvitations(org.orgId);
    await revokeInvitation(org.orgId, invite.id);
    assert.equal(await claimInvitation(crypto.randomUUID(), 'never@store.example'), null);
  });

  test('one org cannot see or claim another org invitations', async () => {
    await inviteMember(rival.orgId, { email: 'theirs@rival.example', role: 'owner' });
    assert.equal((await listPendingInvitations(org.orgId)).length, 0);
    assert.equal((await listPendingInvitations(rival.orgId)).length, 1);

    // The claim function is security definer, so prove it still lands the user
    // in the inviting org and nowhere else.
    const theirStaff = crypto.randomUUID();
    assert.equal(await claimInvitation(theirStaff, 'theirs@rival.example'), rival.orgId);
    assert.equal((await listMembers(org.orgId)).some((m) => m.userId === theirStaff), false);
  });
});

describe('the last owner', () => {
  let org: TestOrg;

  before(async () => {
    org = await createTestOrg('Last Owner Test');
  });

  test('cannot demote themselves', async () => {
    const [owner] = await listMembers(org.orgId);
    await assert.rejects(() => changeMemberRole(org.orgId, owner.id, 'staff'), LastOwnerError);
    assert.equal((await listMembers(org.orgId))[0].role, 'owner');
  });

  test('cannot remove themselves', async () => {
    const [owner] = await listMembers(org.orgId);
    await assert.rejects(() => removeMember(org.orgId, owner.id), LastOwnerError);
    assert.equal((await listMembers(org.orgId)).length, 1);
  });

  test('can step down once a second owner exists', async () => {
    await inviteMember(org.orgId, { email: 'second@store.example', role: 'owner' });
    const second = crypto.randomUUID();
    await claimInvitation(second, 'second@store.example');

    const members = await listMembers(org.orgId);
    const first = members.find((m) => m.userId === org.userId)!;
    await changeMemberRole(org.orgId, first.id, 'manager');

    const after = await listMembers(org.orgId);
    assert.equal(after.filter((m) => m.role === 'owner').length, 1);
    assert.equal(after.find((m) => m.userId === org.userId)!.role, 'manager');
  });
});
