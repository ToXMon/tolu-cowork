/**
 * @tolu/cowork-core — TLS configuration and certificate management
 *
 * Loads TLS/mTLS configuration from file paths, validates certificates,
 * and provides self-signed certificate generation for development.
 */

import * as tls from 'node:tls';
import * as fs from 'node:fs/promises';
import * as crypto from 'node:crypto';
import type { TlsConfig, MtlsConfig } from './types.js';
import { TLSConfigError } from './errors.js';

/** Certificate validation result. */
export interface CertValidationResult {
  /** Whether the certificate file exists and is parseable. */
  valid: boolean;
  /** Expiration date of the certificate. */
  expiresAt: Date;
  /** Certificate issuer distinguished name. */
  issuer: string;
  /** Certificate subject distinguished name. */
  subject: string;
}

/**
 * TLS configuration loader and certificate utilities.
 * Provides static methods for loading, validating, and generating TLS certs.
 */
export class TLSConfigurator {
  /**
   * Load TLS configuration from file paths.
   * Reads cert, key, and optional CA files and returns SecureContext options.
   * @param config - TLS configuration with file paths
   * @returns TLS secure context options ready for use with tls.createServer
   * @throws {TLSConfigError} If files cannot be read or are invalid
   */
  static async loadTlsConfig(config: TlsConfig): Promise<tls.SecureContextOptions> {
    const [cert, key] = await Promise.all([
      fs.readFile(config.certPath, 'utf-8').catch((e: Error) => {
        throw new TLSConfigError(`Failed to read cert file: ${config.certPath}: ${e.message}`);
      }),
      fs.readFile(config.keyPath, 'utf-8').catch((e: Error) => {
        throw new TLSConfigError(`Failed to read key file: ${config.keyPath}: ${e.message}`);
      }),
    ]);

    const result: tls.SecureContextOptions = { cert, key };

    if (config.caPath) {
      result.ca = await fs.readFile(config.caPath, 'utf-8').catch((e: Error) => {
        throw new TLSConfigError(`Failed to read CA file: ${config.caPath}: ${e.message}`);
      });
    }

    const minVersion = config.minVersion === 'TLSv1.2'
      ? 'TLSv1.2' as const
      : 'TLSv1.3' as const;
    result.minVersion = minVersion;

    return result;
  }

  /**
   * Validate a certificate file.
   * Parses the certificate and extracts metadata.
   * @param certPath - Path to PEM-encoded certificate file
   * @returns Validation result with expiry, issuer, and subject
   * @throws {TLSConfigError} If the file cannot be read or parsed
   */
  static async validateCertificate(certPath: string): Promise<CertValidationResult> {
    let certPem: string;
    try {
      certPem = await fs.readFile(certPath, 'utf-8');
    } catch {
      throw new TLSConfigError(`Certificate file not found: ${certPath}`);
    }

    try {
      const x509 = new crypto.X509Certificate(certPem);
      return {
        valid: !x509.ca && new Date(x509.validTo) > new Date(),
        expiresAt: new Date(x509.validTo),
        issuer: x509.issuer,
        subject: x509.subject,
      };
    } catch {
      throw new TLSConfigError(`Failed to parse certificate: ${certPath}`);
    }
  }

  /**
   * Generate a self-signed certificate for development.
   *
   * Uses RSA-2048 key generation. Note: Node.js crypto does not provide
   * built-in X.509 certificate *creation*. This method generates a keypair
   * and provides the openssl command for creating a matching cert.
   *
   * For a fully automated self-signed cert, run the generated command.
   *
   * @param options - Certificate generation options
   * @param options.commonName - Subject common name (e.g. 'localhost')
   * @param options.days - Certificate validity in days (default 365)
   * @returns Object with generated key PEM and openssl command
   * @throws {TLSConfigError} If key generation fails
   */
  static async generateSelfSignedCert(options: {
    commonName: string;
    days?: number;
  }): Promise<{ cert: string; key: string }> {
    const { commonName, days = 365 } = options;

    try {
      const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
      });

      const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
      const _pubPem = publicKey.export({ type: 'spki', format: 'pem' });

      // Node.js crypto can parse but not create X.509 certificates.
      // Build a minimal self-signed cert using DER encoding.
      const certPem = buildSelfSignedCert(privateKey, publicKey, commonName, days);

      return { cert: certPem, key: keyPem as string };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new TLSConfigError(`Failed to generate self-signed cert: ${msg}`);
    }
  }
}

/**
 * Build a minimal self-signed X.509 certificate using DER encoding.
 * Creates a v3 certificate with RSA key and SHA-256 signature.
 */
function buildSelfSignedCert(
  privateKey: crypto.KeyObject,
  publicKey: crypto.KeyObject,
  commonName: string,
  days: number,
): string {
  // ASN.1 DER encoding helpers
  function asn1Tag(tag: number, content: Buffer): Buffer {
    const buffers: Buffer[] = [Buffer.from([tag])];
    const len = content.length;
    if (len < 128) {
      buffers.push(Buffer.from([len]));
    } else if (len < 256) {
      buffers.push(Buffer.from([0x81, len]));
    } else {
      buffers.push(Buffer.from([0x82, (len >> 8) & 0xff, len & 0xff]));
    }
    buffers.push(content);
    return Buffer.concat(buffers);
  }

  function asn1Integer(value: number | bigint): Buffer {
    if (typeof value === 'number') {
      value = BigInt(value);
    }
    let hex = value.toString(16);
    if (hex.length % 2) hex = '0' + hex;
    let buf = Buffer.from(hex, 'hex');
    if (buf[0] & 0x80) buf = Buffer.concat([Buffer.from([0x00]), buf]);
    return asn1Tag(0x02, buf);
  }

  function asn1Oid(oid: string): Buffer {
    const parts = oid.split('.').map(Number);
    const bytes: number[] = [40 * parts[0] + parts[1]];
    for (let i = 2; i < parts.length; i++) {
      let val = parts[i];
      if (val < 128) {
        bytes.push(val);
      } else {
        const encoded: number[] = [];
        encoded.push(val & 0x7f);
        val >>>= 7;
        while (val) {
          encoded.push(0x80 | (val & 0x7f));
          val >>>= 7;
        }
        bytes.push(...encoded.reverse());
      }
    }
    return asn1Tag(0x06, Buffer.from(bytes));
  }

  function asn1Null(): Buffer {
    return Buffer.from([0x05, 0x00]);
  }

  function asn1Utf8String(str: string): Buffer {
    return asn1Tag(0x0c, Buffer.from(str, 'utf-8'));
  }

  function asn1PrintableString(str: string): Buffer {
    return asn1Tag(0x13, Buffer.from(str, 'ascii'));
  }

  function asn1Sequence(...items: Buffer[]): Buffer {
    return asn1Tag(0x30, Buffer.concat(items));
  }

  function asn1Set(...items: Buffer[]): Buffer {
    return asn1Tag(0x31, Buffer.concat(items));
  }

  function asn1BitString(content: Buffer): Buffer {
    return asn1Tag(0x03, Buffer.concat([Buffer.from([0x00]), content]));
  }

  function asn1UtcTime(date: Date): Buffer {
    const pad2 = (n: number) => n.toString().padStart(2, '0');
    const str = `${pad2(date.getUTCFullYear() % 100)}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(date.getUTCSeconds())}Z`;
    return asn1Tag(0x17, Buffer.from(str, 'ascii'));
  }

  // Build subject DN: CN=commonName
  const subject = asn1Sequence(
    asn1Set(
      asn1Sequence(
        asn1Oid('2.5.4.3'), // CN OID
        asn1Utf8String(commonName),
      ),
    ),
  );

  // Serial number (random)
  const serial = asn1Integer(BigInt(Date.now()));

  // Validity
  const now = new Date();
  const expires = new Date(now.getTime() + days * 86400_000);
  const validity = asn1Sequence(asn1UtcTime(now), asn1UtcTime(expires));

  // Signature algorithm: SHA-256 with RSA
  const sigAlg = asn1Sequence(asn1Oid('1.2.840.113549.1.1.11'), asn1Null());

  // Subject public key info
  const pubDer = publicKey.export({ type: 'spki', format: 'der' });
  // Version: [0] EXPLICIT INTEGER 2 (v3)
  const version = asn1Tag(0xa0, asn1Integer(2));
  const tbsCert = asn1Sequence(
    version,
    serial,
    sigAlg,
    subject, // issuer = subject (self-signed)
    validity,
    subject,
    pubDer,
  );

  // Sign
  const signer = crypto.createSign('SHA256');
  signer.update(tbsCert);
  signer.end();
  const signature = signer.sign(privateKey);

  // Certificate = SEQUENCE(TBSCertificate, SignatureAlgorithm, SignatureValue)
  const cert = asn1Sequence(
    tbsCert,
    sigAlg,
    asn1BitString(signature),
  );

  // Encode as PEM
  const b64 = cert.toString('base64');
  const lines = (b64.match(/.{1,64}/g) ?? []).join('\n');
  return `-----BEGIN CERTIFICATE-----\n${lines}\n-----END CERTIFICATE-----\n`;
}
