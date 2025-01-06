import { describe, it, expect, beforeEach } from 'vitest';
import { GoogleCloudSecretsProvider } from '../src/lib/providers/GoogleCloudSecrets.js';

describe('GoogleCloudSecretsProvider', () => {
    let provider: GoogleCloudSecretsProvider;
    let projectId: string;

    beforeEach(() => {
        const envProjectId = process.env.GOOGLE_CLOUD_PROJECT;
        if (!envProjectId) {
            throw new Error('GOOGLE_CLOUD_PROJECT environment variable must be set');
        }
        projectId = envProjectId;
        provider = new GoogleCloudSecretsProvider();
    });

    it('should throw error for invalid path format', async () => {
        await expect(provider.getSecret('invalid-path'))
            .rejects
            .toThrow('Invalid Google Cloud secret path');
    });

    it('should retrieve entire secret as JSON when no key specified', async () => {
        const secret = await provider.getSecret(`gcsm://projects/${projectId}/secrets/test-json-secret/versions/latest`);
        expect(typeof secret).toBe('string');
        expect(() => JSON.parse(secret)).not.toThrow();
        const parsed = JSON.parse(secret);
        expect(parsed).toBeTypeOf('object');
        expect(parsed['bar']).toBe('baz');
    });

    it('should retrieve plaintext secret when no key specified', async () => {
        const secret = await provider.getSecret(`gcsm://projects/${projectId}/secrets/test-plain-secret/versions/latest`);
        expect(typeof secret).toBe('string');
        expect(secret).toBe('12345');
    });

    it('should retrieve specific key from secret', async () => {
        const secret = await provider.getSecret(`gcsm://projects/${projectId}/secrets/test-json-secret/versions/latest:bar`);
        expect(typeof secret).toBe('string');
        expect(secret.length).toBeGreaterThan(0);
        expect(secret).toBe('baz');
    });

    it('should throw on invalid path', async () => {
        await expect(provider.getSecret(`gcsm://projects/${projectId}/secrets/non-existent-secret/versions/latest`))
            .rejects
            .toThrow(/Failed to read Google Cloud secret/);
    });

    it('should throw on invalid key in key-value secret', async () => {
        await expect(provider.getSecret(`gcsm://projects/${projectId}/secrets/test-json-secret/versions/latest:non-existent-key`))
            .rejects
            .toThrow(/Key 'non-existent-key' not found in secret/);
    });

    it('should handle non-JSON secret with key specified', async () => {
        await expect(provider.getSecret(`gcsm://projects/${projectId}/secrets/test-plain-secret/versions/latest:some-key`))
            .rejects
            .toThrow('Secret is not a valid JSON object but a key was requested');
    });
}); 