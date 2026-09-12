export interface SecretCipher {
  encrypt(plaintext: string): string;
  decrypt(payload: string): string;
}
