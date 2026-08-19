#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const secret = JSON.parse(
  fs.readFileSync(path.join(process.env.USERPROFILE, '.expo', 'state.json'), 'utf8')
).auth.sessionSecret;

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

const PROJECT_ID = 'fb698c1a-44e6-49cb-a596-a49f76f91e89';
const BUNDLE = 'com.powerflexy.app';
const KEY_ID = 'T62VL65K47';
const TEAM = 'ZSMFNJV9RU';

(async () => {
  const info = await gql(
    `query($appId: String!) {
      app {
        byId(appId: $appId) {
          id
          ownerAccount { id }
          iosAppCredentials {
            id
            appleAppIdentifier { id bundleIdentifier }
            pushKey { keyIdentifier }
          }
        }
      }
    }`,
    { appId: PROJECT_ID }
  );
  const app = info.app.byId;
  const acct = (
    await gql(
      `query($accountId: String!) {
        account {
          byId(accountId: $accountId) {
            appleTeams { id appleTeamIdentifier }
            applePushKeys { id keyIdentifier }
            appleAppIdentifiers { id bundleIdentifier }
          }
        }
      }`,
      { accountId: app.ownerAccount.id }
    )
  ).account.byId;

  const appleTeam = acct.appleTeams.find((t) => t.appleTeamIdentifier === TEAM);
  const pushKey = acct.applePushKeys.find((k) => k.keyIdentifier === KEY_ID);
  const appIdRow = acct.appleAppIdentifiers.find((a) => a.bundleIdentifier === BUNDLE);
  console.log({ app: app.id, team: appleTeam.id, pushKey: pushKey.id, ident: appIdRow.id });

  let cred = (app.iosAppCredentials || []).find(
    (c) => c.appleAppIdentifier?.bundleIdentifier === BUNDLE
  );

  if (!cred) {
    const shapes = [
      {
        name: 'top-level-ids-empty-input',
        q: `mutation($appId: ID!, $appleAppIdentifierId: ID!, $input: IosAppCredentialsInput!) {
          iosAppCredentials {
            createIosAppCredentials(
              appId: $appId
              appleAppIdentifierId: $appleAppIdentifierId
              iosAppCredentialsInput: $input
            ) { id pushKey { keyIdentifier } }
          }
        }`,
        v: { appId: app.id, appleAppIdentifierId: appIdRow.id, input: {} },
      },
      {
        name: 'with-team-in-input',
        q: `mutation($appId: ID!, $appleAppIdentifierId: ID!, $input: IosAppCredentialsInput!) {
          iosAppCredentials {
            createIosAppCredentials(
              appId: $appId
              appleAppIdentifierId: $appleAppIdentifierId
              iosAppCredentialsInput: $input
            ) { id }
          }
        }`,
        v: {
          appId: app.id,
          appleAppIdentifierId: appIdRow.id,
          input: { appleTeamId: appleTeam.id },
        },
      },
    ];
    for (const s of shapes) {
      try {
        const r = await gql(s.q, s.v);
        cred = r.iosAppCredentials.createIosAppCredentials;
        console.log('CREATED via', s.name, cred.id);
        break;
      } catch (e) {
        console.log(s.name, 'fail', String(e.message).slice(0, 500));
      }
    }
  } else {
    console.log('Existing cred', cred.id, cred.pushKey?.keyIdentifier);
  }

  if (!cred?.id) throw new Error('create failed');

  if (cred.pushKey?.keyIdentifier === KEY_ID) {
    console.log('Already linked');
    return;
  }

  const linked = await gql(
    `mutation($id: ID!, $pushKeyId: ID!) {
      iosAppCredentials {
        setPushKey(id: $id, pushKeyId: $pushKeyId) {
          id
          pushKey { keyIdentifier }
        }
      }
    }`,
    { id: cred.id, pushKeyId: pushKey.id }
  );
  console.log('LINKED', JSON.stringify(linked));
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
