/**
 * Upload APNs .p8 to Expo and link to @ercanaslan3/powerflexy-mobile.
 *
 * Usage:
 *   node _tmp_upload_apns.js path/to/AuthKey_XXXX.p8 KEY_ID
 */
const fs = require('fs');
const path = require('path');

const p8Path = process.argv[2];
const keyIdentifier = process.argv[3];
if (!p8Path || !keyIdentifier) {
  console.error('Usage: node _tmp_upload_apns.js AuthKey_XXXX.p8 KEY_ID');
  process.exit(1);
}

const TEAM_IDENTIFIER = 'ZSMFNJV9RU';
const BUNDLE_ID = 'com.powerflexy.app';
const PROJECT_ID = 'fb698c1a-44e6-49cb-a596-a49f76f91e89';

const keyP8 = fs.readFileSync(path.resolve(p8Path), 'utf8');
if (!keyP8.includes('BEGIN PRIVATE KEY')) {
  console.error('Invalid .p8');
  process.exit(1);
}

function loadSession() {
  const candidates = [
    path.join(process.env.USERPROFILE || '', '.expo', 'state.json'),
    path.join('C:\\Users\\ilknuraslan', '.expo', 'state.json'),
  ];
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const state = JSON.parse(fs.readFileSync(p, 'utf8'));
      const secret = state?.auth?.sessionSecret;
      if (secret) {
        console.log('Expo session from', p);
        return secret;
      }
    } catch (_) {}
  }
  throw new Error('No Expo session. Run: npx eas login');
}

const secret = loadSession();

async function gql(query, variables) {
  const r = await fetch('https://api.expo.dev/graphql', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'expo-session': secret,
    },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors?.length) throw new Error(JSON.stringify(j.errors, null, 2));
  return j.data;
}

(async () => {
  const info = await gql(
    `
    query($appId: String!) {
      app {
        byId(appId: $appId) {
          id
          fullName
          ownerAccount { id name }
          iosAppCredentials {
            id
            appleAppIdentifier { bundleIdentifier }
            pushKey { id keyIdentifier }
          }
        }
      }
    }
  `,
    { appId: PROJECT_ID }
  );

  const app = info.app?.byId;
  if (!app) throw new Error('App not found for projectId ' + PROJECT_ID);
  console.log('App:', app.fullName, 'owner=', app.ownerAccount?.name);

  const accountId = app.ownerAccount?.id;
  if (!accountId) throw new Error('No ownerAccount');

  const teams = await gql(
    `
    query($accountId: String!) {
      account {
        byId(accountId: $accountId) {
          id
          name
          appleTeams { id appleTeamIdentifier appleTeamName }
          applePushKeys { id keyIdentifier }
        }
      }
    }
  `,
    { accountId }
  );

  const acct = teams.account?.byId;
  console.log(
    'Existing push keys:',
    (acct?.applePushKeys || []).map((k) => k.keyIdentifier).join(', ') || '(none)'
  );
  const appleTeam = (acct?.appleTeams || []).find((t) => t.appleTeamIdentifier === TEAM_IDENTIFIER);
  if (!appleTeam) {
    throw new Error(
      'AppleTeam ' +
        TEAM_IDENTIFIER +
        ' not linked on Expo. Run once: npx eas credentials -p ios (link Apple team), then retry.'
    );
  }
  console.log('AppleTeam', appleTeam.id, appleTeam.appleTeamIdentifier);

  let pushKeyId = (acct?.applePushKeys || []).find((k) => k.keyIdentifier === keyIdentifier)?.id;
  if (pushKeyId) {
    console.log('Push key already on Expo account:', pushKeyId);
  } else {
    const push = await gql(
      `
      mutation($input: ApplePushKeyInput!, $accountId: ID!) {
        applePushKey {
          createApplePushKey(applePushKeyInput: $input, accountId: $accountId) {
            id
            keyIdentifier
          }
        }
      }
    `,
      {
        accountId,
        input: { keyP8, keyIdentifier, appleTeamId: appleTeam.id },
      }
    );
    pushKeyId = push.applePushKey.createApplePushKey.id;
    console.log('Created ApplePushKey', push.applePushKey.createApplePushKey);
  }

  let cred = (app.iosAppCredentials || []).find(
    (c) => c.appleAppIdentifier?.bundleIdentifier === BUNDLE_ID
  );
  if (!cred) cred = (app.iosAppCredentials || [])[0];
  if (!cred?.id) {
    // Create ios app credentials + apple app identifier if missing
    console.log('No iosAppCredentials — creating…');
    const created = await gql(
      `
      mutation($appId: ID!, $appleAppIdentifierId: ID!, $appleTeamId: ID!) {
        iosAppCredentials {
          createIosAppCredentials(
            appId: $appId
            appleAppIdentifierId: $appleAppIdentifierId
            appleTeamId: $appleTeamId
          ) {
            id
            pushKey { id keyIdentifier }
          }
        }
      }
    `,
      { appId: app.id, appleAppIdentifierId: 'NEED', appleTeamId: appleTeam.id }
    ).catch((e) => {
      console.error('createIosAppCredentials failed (expected if identifier missing):', e.message);
      return null;
    });
    if (!created) {
      throw new Error(
        'No iosAppCredentials for ' +
          BUNDLE_ID +
          '. Build once with remote credentials or run eas credentials -p ios.'
      );
    }
    cred = created.iosAppCredentials.createIosAppCredentials;
  }

  console.log('iosAppCredentials', cred.id, 'pushKey=', cred.pushKey?.keyIdentifier || '(none)');

  if (cred.pushKey?.keyIdentifier === keyIdentifier) {
    console.log('Already linked. Done.');
    return;
  }

  const linked = await gql(
    `
    mutation($id: ID!, $pushKeyId: ID!) {
      iosAppCredentials {
        setPushKey(id: $id, pushKeyId: $pushKeyId) {
          id
          pushKey { id keyIdentifier }
        }
      }
    }
  `,
    { id: cred.id, pushKeyId }
  );
  console.log('Linked:', JSON.stringify(linked, null, 2));
  console.log('OK — iOS push credentials on Expo for PowerFlexy.');
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
