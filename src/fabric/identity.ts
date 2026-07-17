import { readFile } from 'node:fs/promises';
import { type Identity, type Signer, signers } from '@hyperledger/fabric-gateway';
import * as crypto from 'node:crypto';
import { loadEnv } from '../config/env.js';

/**
 * MSP identity / wallet loading for the bridge's Fabric Gateway client.
 *
 * NOTE: This repo does NOT create MSP/CA material or configure the network —
 * that lives in `centuries-ledger`. Here we only LOAD the client identity the
 * bridge uses to connect as a registered user.
 *
 * SECURITY: cert/key contents must never be logged. Only paths are referenced.
 */

export async function loadIdentity(): Promise<Identity> {
  const env = loadEnv();
  if (!env.FABRIC_CERT_PATH) {
    throw new Error('FABRIC_CERT_PATH is required to load the Fabric identity.');
  }
  const credentials = await readFile(env.FABRIC_CERT_PATH);
  return { mspId: env.FABRIC_MSP_ID, credentials };
}

export async function loadSigner(): Promise<Signer> {
  const env = loadEnv();
  if (!env.FABRIC_PRIVATE_KEY_PATH) {
    throw new Error('FABRIC_PRIVATE_KEY_PATH is required to load the Fabric signer.');
  }
  const privateKeyPem = await readFile(env.FABRIC_PRIVATE_KEY_PATH);
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  return signers.newPrivateKeySigner(privateKey);
}
