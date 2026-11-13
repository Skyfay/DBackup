/**
 * The server starts with the whole tls.crt and tls.key, every block of them. An upload that the
 * server could not load would keep DBackup from serving after the next start, with no way back
 * through the app, so it is refused before anything replaces the files.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockExecSync, mockExistsSync, mockWriteFileSync, mockMkdirSync, mockUnlinkSync, mockRenameSync } = vi.hoisted(() => ({
  mockExecSync: vi.fn(),
  mockExistsSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockUnlinkSync: vi.fn(),
  mockRenameSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({ default: { execSync: mockExecSync }, execSync: mockExecSync }));

vi.mock("node:fs", () => {
  const fs = {
    existsSync: mockExistsSync,
    writeFileSync: mockWriteFileSync,
    mkdirSync: mockMkdirSync,
    unlinkSync: mockUnlinkSync,
    renameSync: mockRenameSync,
  };
  return { default: fs, ...fs };
});

vi.mock("@/lib/logging/logger", () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}));

import { uploadCertificate } from "@/services/system/certificate-service";
import { assertServableCertificate } from "@/services/system/certificate-check";

// Throwaway self-signed test certificates (CN a.dbackup.test and b.dbackup.test) with their keys,
// made for this file only and used nowhere.
const CERT_A = `-----BEGIN CERTIFICATE-----
MIIBiDCCAS+gAwIBAgIUJz8DC9/WF1nZgPSuFh41sutsFBgwCgYIKoZIzj0EAwIw
GTEXMBUGA1UEAwwOYS5kYmFja3VwLnRlc3QwIBcNMjYxMTExMDYzMjUyWhgPMjEy
NjEwMTgwNjMyNTJaMBkxFzAVBgNVBAMMDmEuZGJhY2t1cC50ZXN0MFkwEwYHKoZI
zj0CAQYIKoZIzj0DAQcDQgAE3ENt11NgQq9iNAMXzmou5eukZ2jBIUInp+LkDj8g
DmzWE+YtzzUfturiQ6XyzwCxBUg5FJAEnhcAL+xL8hGYO6NTMFEwHQYDVR0OBBYE
FC1RMkHp7vzKdeUlGnqwMQx+QEd3MB8GA1UdIwQYMBaAFC1RMkHp7vzKdeUlGnqw
MQx+QEd3MA8GA1UdEwEB/wQFMAMBAf8wCgYIKoZIzj0EAwIDRwAwRAIgANaEwM/0
VidWl0nYakZgawcnoihP5IXsc2sLG+Umh7cCID+Recbb0kr0U2sVO3Sczknj07J5
iMwRZp3h2XldVSOs
-----END CERTIFICATE-----
`;
const KEY_A = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgrgUylDcdTvAHeeQX
nTR7jjRMRwcYGVUtgK/E23JO7bShRANCAATcQ23XU2BCr2I0AxfOai7l66RnaMEh
Qien4uQOPyAObNYT5i3PNR+26uJDpfLPALEFSDkUkASeFwAv7EvyEZg7
-----END PRIVATE KEY-----
`;
const CERT_B = `-----BEGIN CERTIFICATE-----
MIIBijCCAS+gAwIBAgIUKntC/ndTYvDrt1XLTXmrBUnAp7kwCgYIKoZIzj0EAwIw
GTEXMBUGA1UEAwwOYi5kYmFja3VwLnRlc3QwIBcNMjYxMTExMDYzMjUyWhgPMjEy
NjEwMTgwNjMyNTJaMBkxFzAVBgNVBAMMDmIuZGJhY2t1cC50ZXN0MFkwEwYHKoZI
zj0CAQYIKoZIzj0DAQcDQgAEpV3z67xTSTDi0ZVDrjam8Kvpozv78VXiRpP58kNF
Aqcxn4hFy16kyfE8N14P3gSPglgePGFhVZlEoKC+weEK86NTMFEwHQYDVR0OBBYE
FHFTgJOJhPq/k7ypTR8sdLj/RqIxMB8GA1UdIwQYMBaAFHFTgJOJhPq/k7ypTR8s
dLj/RqIxMA8GA1UdEwEB/wQFMAMBAf8wCgYIKoZIzj0EAwIDSQAwRgIhALbflHhc
NAvbXNHsswZurZFbHckRPzrh4gzNCIKIEjYOAiEA42u40TRieFMHPQ44g1tN7BId
AEEKI3TlDvxFmT4S9p8=
-----END CERTIFICATE-----
`;
const KEY_B = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgid861i/EUDzz2Zy+
jY0KYysa9VT59PFl/t3EkOHgzUmhRANCAASlXfPrvFNJMOLRlUOuNqbwq+mjO/vx
VeJGk/nyQ0UCpzGfiEXLXqTJ8Tw3Xg/eBI+CWB48YWFVmUSgoL7B4Qrz
-----END PRIVATE KEY-----
`;
const JUNK_CERT = "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n";
const PUBLIC_KEY = "-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE\n-----END PUBLIC KEY-----";

const refusal = expect.objectContaining({ code: "VALIDATION_ERROR" });

describe("an uploaded TLS certificate the server could not start with", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    // What openssl answers for such files: it reads the first block only and finds nothing wrong.
    mockExecSync.mockImplementation((cmd: string) => (cmd.includes("-pubkey") || cmd.includes("-pubout") ? PUBLIC_KEY : ""));
  });

  it("is refused when a block after the first certificate is no readable certificate, and the files of the server stay", () => {
    expect(() => uploadCertificate(CERT_A + JUNK_CERT, KEY_A)).toThrow(refusal);

    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(mockRenameSync).not.toHaveBeenCalled();
  });

  it("is refused when the certificate file holds a block of another kind, like the private key", () => {
    expect(() => uploadCertificate(CERT_A + KEY_A, KEY_A)).toThrow(refusal);
    expect(mockRenameSync).not.toHaveBeenCalled();
  });

  it("is refused when a block has no END line", () => {
    expect(() => uploadCertificate(`${CERT_A}-----BEGIN CERTIFICATE-----\nMIIB\n`, KEY_A)).toThrow(refusal);
    expect(mockRenameSync).not.toHaveBeenCalled();
  });

  it("is refused when the key file holds a second key or a block that is no key", () => {
    expect(() => uploadCertificate(CERT_A, KEY_A + KEY_B)).toThrow(refusal);
    expect(() => uploadCertificate(CERT_A, KEY_A + CERT_A)).toThrow(refusal);
    expect(mockRenameSync).not.toHaveBeenCalled();
  });

  it("is refused when the key cannot be read", () => {
    const brokenKey = "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n";
    expect(() => uploadCertificate(CERT_A, brokenKey)).toThrow(refusal);
    expect(mockRenameSync).not.toHaveBeenCalled();
  });

  it("is refused when the key belongs to another certificate, also to one further down the chain", () => {
    expect(() => assertServableCertificate(CERT_A, KEY_B)).toThrow("do not match");
    expect(() => assertServableCertificate(CERT_A + CERT_B, KEY_B)).toThrow("do not match");
  });
});

describe("an uploaded TLS certificate the server starts with", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    mockExecSync.mockImplementation((cmd: string) => (cmd.includes("-pubkey") || cmd.includes("-pubout") ? PUBLIC_KEY : ""));
  });

  it("replaces the files, alone or with its chain behind it", () => {
    uploadCertificate(CERT_A, KEY_A);
    expect(mockRenameSync).toHaveBeenCalledTimes(2);

    mockRenameSync.mockClear();
    uploadCertificate(CERT_A + CERT_B, KEY_A);
    expect(mockRenameSync).toHaveBeenCalledTimes(2);
  });
});
