import { describe, it, expect, beforeEach } from 'vitest';
import { AWSSecretsManagerProvider } from '../src/lib/providers/AWSSecretsManager.js';

describe('AWSSecretsManagerProvider', () => {
    let provider: AWSSecretsManagerProvider;
    let region: string;

    beforeEach(() => {
        region = process.env.AWS_REGION || 'us-east-1';
        provider = new AWSSecretsManagerProvider();
    });

    it('should throw error for invalid path format', async () => {
        await expect(provider.getSecret('invalid-path'))
            .rejects
            .toThrow('Invalid AWS secret path format');
    });

    it('should retrieve entire secret as JSON when no key specified', async () => {
        const secret = await provider.getSecret(`awssm://${region}/test/test-secret`);
        expect(typeof secret).toBe('string');
        expect(() => JSON.parse(secret)).not.toThrow();
        const parsed = JSON.parse(secret);
        expect(parsed).toBeTypeOf('object');
        expect(parsed['secret-key']).toBe('secret-value');
    });

    it('should retrieve plaintext secret when no key specified', async () => {
        const secret = await provider.getSecret(`awssm://${region}/test/test-plain-secret`);
        expect(typeof secret).toBe('string');
        expect(secret).toBe('12345');
    });

    it('should retrieve specific key from secret', async () => {
        const secret = await provider.getSecret(`awssm://${region}/test/test-secret::secret-key`);
        expect(typeof secret).toBe('string');
        expect(secret.length).toBeGreaterThan(0);
        expect(secret).toBe('secret-value');
    });

    it('should throw on invalid path', async () => {
        await expect(provider.getSecret(`awssm://${region}/non-existent-secret`))
            .rejects
            .toThrow(/Failed to read AWS secret/);
    });

    it('should throw on invalid key in key-value secret', async () => {
        await expect(provider.getSecret(`awssm://${region}/test/test-secret::non-existent-key`))
            .rejects
            .toThrow(/Key 'non-existent-key' not found in secret/);
    });

    it('should handle non-JSON secret with key specified', async () => {
        await expect(provider.getSecret(`awssm://${region}/test/test-plain-secret::some-key`))
            .rejects
            .toThrow('Secret is not a valid JSON object but a key was requested');
    });
});
