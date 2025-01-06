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

    it('should retrieve string secret', async () => {
        const secret = await provider.getSecret(`gcsm://projects/${projectId}/secrets/test-secret/versions/latest`);
        expect(typeof secret).toBe('string');
        expect(secret.length).toBeGreaterThan(0);
        console.log(secret);
        expect(secret).toBe('secret-value');
    });

    it('should throw on invalid path', async () => {
        await expect(provider.getSecret(`gcsm://projects/${projectId}/secrets/non-existent-secret/versions/latest`))
            .rejects
            .toThrow(/Failed to read Google Cloud secret/);
    });

    it('should handle JSON string secret', async () => {
        const secret = await provider.getSecret(`gcsm://projects/${projectId}/secrets/test-json-secret/versions/latest`);
        expect(typeof secret).toBe('string');
        // Verify it's valid JSON
        expect(() => JSON.parse(secret)).not.toThrow();
        const parsed = JSON.parse(secret);
        expect(parsed).toBeTypeOf('object');
        expect(parsed.bar).toBe('baz');
    });

    it('should handle JSON blob string secret', async () => {
        const secret = await provider.getSecret(`gcsm://projects/${projectId}/secrets/test-json-secret-blob/versions/latest`);
        expect(typeof secret).toBe('string');
        // Verify it's valid JSON
        expect(() => JSON.parse(secret)).not.toThrow();
        const parsed = JSON.parse(secret);
        expect(parsed).toBeTypeOf('object');
        expect(parsed.foo).toBe('bar');
    });
}); 