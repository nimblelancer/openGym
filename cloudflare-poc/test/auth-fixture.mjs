// Disposable ES256 authenticator fixture. Never use this as a real credential store.
import { generateKeyPairSync, randomBytes, createHash, sign } from 'node:crypto';
const hash = b => createHash('sha256').update(b).digest();
const b64 = b => Buffer.from(b).toString('base64url');
const cat = (...b) => Buffer.concat(b);
function head(major, n) {
  if (n < 24) return Buffer.from([major * 32 + n]);
  if (n < 256) return Buffer.from([major * 32 + 24, n]);
  if (n < 65536) return Buffer.from([major * 32 + 25, n >> 8, n & 255]);
  throw Error('fixture CBOR limit');
}
function cbor(v) {
  if (Buffer.isBuffer(v)) return cat(head(2, v.length), v);
  if (typeof v === 'string') { const b = Buffer.from(v); return cat(head(3, b.length), b); }
  if (typeof v === 'number') return head(v < 0 ? 1 : 0, v < 0 ? -1-v : v);
  if (v instanceof Map) return cat(head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)]));
  throw Error('unsupported fixture CBOR value');
}
export function authenticator() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const cose = cbor(new Map([[1,2],[3,-7],[-1,1],[-2,Buffer.from(jwk.x,'base64url')],[-3,Buffer.from(jwk.y,'base64url')]]));
  const id = randomBytes(32);
  const rpHash = hash('poc.invalid');
  const client = (type, challenge) => Buffer.from(JSON.stringify({ type, challenge, origin: 'https://poc.invalid', crossOrigin: false }));
  const authData = (flag, count) => { const c = Buffer.alloc(4); c.writeUInt32BE(count); return cat(rpHash, Buffer.from([flag]), c); };
  const common = { id: b64(id), rawId: b64(id), type: 'public-key', clientExtensionResults: {}, authenticatorAttachment: 'platform' };
  return {
    register(challenge) {
      const len = Buffer.alloc(2); len.writeUInt16BE(id.length);
      const data = cat(authData(0x45,0), Buffer.alloc(16), len, id, cose);
      const obj = cbor(new Map([['fmt','none'],['attStmt',new Map()],['authData',data]]));
      return { ...common, response: { clientDataJSON: b64(client('webauthn.create',challenge)), attestationObject: b64(obj), transports: ['internal'] } };
    },
    login(challenge, count = 1) {
      const cd = client('webauthn.get', challenge), ad = authData(0x05,count);
      return { ...common, response: { clientDataJSON: b64(cd), authenticatorData: b64(ad),
        signature: b64(sign('sha256', cat(ad, hash(cd)), privateKey)) } };
    }
  };
}
