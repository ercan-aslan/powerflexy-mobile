#!/usr/bin/env node
/** Create legacy-friendly PKCS#12 using node-forge */
const fs = require('fs');
const path = require('path');
const forge = require('node-forge');

const CRED = path.join(__dirname, 'credentials');
const keyPem = fs.readFileSync(path.join(CRED, 'dist.key'), 'utf8');
const cerDer = fs.readFileSync(path.join(CRED, 'dist.cer'));
const wwdrDer = fs.readFileSync(path.join(CRED, 'AppleWWDRCAG3.cer'));

const privateKey = forge.pki.privateKeyFromPem(keyPem);
const certAsn1 = forge.asn1.fromDer(forge.util.createBuffer(cerDer.toString('binary')));
const cert = forge.pki.certificateFromAsn1(certAsn1);
const caAsn1 = forge.asn1.fromDer(forge.util.createBuffer(wwdrDer.toString('binary')));
const ca = forge.pki.certificateFromAsn1(caAsn1);

const p12Asn1 = forge.pkcs12.toPkcs12Asn1(privateKey, [cert, ca], 'powerflexy', {
  algorithm: '3des', // legacy macOS keychain friendly
});
const p12Der = forge.asn1.toDer(p12Asn1).getBytes();
fs.writeFileSync(path.join(CRED, 'dist.p12'), Buffer.from(p12Der, 'binary'));
console.log('wrote dist.p12', fs.statSync(path.join(CRED, 'dist.p12')).size);
fs.writeFileSync(
  path.join(__dirname, 'credentials.json'),
  JSON.stringify(
    {
      ios: {
        provisioningProfilePath: 'credentials/profile.mobileprovision',
        distributionCertificate: {
          path: 'credentials/dist.p12',
          password: 'powerflexy',
        },
      },
    },
    null,
    2
  )
);
console.log('credentials.json ok');
