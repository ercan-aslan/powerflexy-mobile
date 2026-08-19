#!/usr/bin/env node
/**
 * Create iosAppCredentials for PowerFlexy and link existing APNs key T62VL65K47.
 */
const fs = require('fs');
const path = require('path');

const TEAM_IDENTIFIER = 'ZSMFNJV9RU';
const BUNDLE_ID = 'com.powerflexy.app';
const PROJECT_ID = 'fb698c1a-44e6-49cb-a596-a49f76f91e89';
const KEY_ID = 'T62VL65K47';

function loadSession() {
  const p = path.join(process.env.USERPROFILE || '', '.expo', 'state.json');
  const state = JSON.parse(fs.readFileSync(p, 'utf8'));
  return state.auth.sessionSecret;
}

const secret = loadSession();

async function gql(query, variables) {
  const r = await fetch('https://api.expo.dev/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'expo-session': secret },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors?.length) throw new Error(JSON.stringify(j.errors, null, 2));
  return j.data;
}

(async () => {
  const info = await gql(
    `query($appId: String!) {
      app { byId(appId: $appId) {
        id fullName
        ownerAccount { id name }
        iosAppCredentials { id appleAppIdentifier { id bundleIdentifier } pushKey { keyIdentifier } }
      } }
    }`,
    { appId: PROJECT_ID }
  );
  const app = info.app.byId;
  console.log('App', app.fullName, app.id);
  const accountId = app.ownerAccount.id;

  const acct = (
    await gql(
      `query($accountId: String!) {
        account { byId(accountId: $accountId) {
          appleTeams { id appleTeamIdentifier }
          applePushKeys { id keyIdentifier }
          appleAppIdentifiers { id bundleIdentifier }
        } }
      }`,
      { accountId }
    )
  ).account.byId;

  const appleTeam = acct.appleTeams.find((t) => t.appleTeamIdentifier === TEAM_IDENTIFIER);
  const pushKey = acct.applePushKeys.find((k) => k.keyIdentifier === KEY_ID);
  console.log('team', appleTeam?.id, 'pushKey', pushKey?.id);

  let appIdRow = (acct.appleAppIdentifiers || []).find((a) => a.bundleIdentifier === BUNDLE_ID);
  if (!appIdRow) {
    console.log('Creating appleAppIdentifier…');
    const created = await gql(
      `mutation($accountId: ID!, $bundleIdentifier: String!, $appleTeamId: ID) {
        appleAppIdentifier {
          createAppleAppIdentifier(
            appleAppIdentifierInput: { bundleIdentifier: $bundleIdentifier, appleTeamId: $appleTeamId }
            accountId: $accountId
          ) { id bundleIdentifier }
        }
      }`,
      { accountId, bundleIdentifier: BUNDLE_ID, appleTeamId: appleTeam.id }
    );
    appIdRow = created.appleAppIdentifier.createAppleAppIdentifier;
    console.log('Created identifier', appIdRow);
  } else {
    console.log('Identifier exists', appIdRow.id);
  }

  let cred = (app.iosAppCredentials || []).find(
    (c) => c.appleAppIdentifier?.bundleIdentifier === BUNDLE_ID
  );
  if (!cred) {
    console.log('Creating iosAppCredentials…');
    // Try several input shapes
    const attempts = [
      {
        name: 'v1',
        query: `mutation($appId: ID!, $input: IosAppCredentialsInput!) {
          iosAppCredentials {
            createIosAppCredentials(appId: $appId, iosAppCredentialsInput: $input) {
              id pushKey { keyIdentifier }
            }
          }
        }`,
        variables: {
          appId: app.id,
          input: {
            appleAppIdentifierId: appIdRow.id,
            appleTeamId: appleTeam.id,
          },
        },
      },
      {
        name: 'v2',
        query: `mutation($appId: ID!, $input: IosAppCredentialsInput!) {
          iosAppCredentials {
            createIosAppCredentials(appId: $appId, iosAppCredentialsInput: $input) {
              id pushKey { keyIdentifier }
            }
          }
        }`,
        variables: {
          appId: app.id,
          input: { appleAppIdentifierId: appIdRow.id },
        },
      },
    ];
    for (const a of attempts) {
      try {
        const r = await gql(a.query, a.variables);
        cred = r.iosAppCredentials.createIosAppCredentials;
        console.log('Created credentials via', a.name, cred.id);
        break;
      } catch (e) {
        console.log(a.name, 'failed:', String(e.message).slice(0, 400));
      }
    }
  }

  if (!cred?.id) throw new Error('Still no iosAppCredentials');

  if (cred.pushKey?.keyIdentifier === KEY_ID) {
    console.log('Already linked');
    return;
  }

  const linked = await gql(
    `mutation($id: ID!, $pushKeyId: ID!) {
      iosAppCredentials {
        setPushKey(id: $id, pushKeyId: $pushKeyId) {
          id pushKey { id keyIdentifier }
        }
      }
    }`,
    { id: cred.id, pushKeyId: pushKey.id }
  );
  console.log('Linked', JSON.stringify(linked, null, 2));
  console.log('OK');
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
