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
            .toThrow('Invalid URI: invalid-path');
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
        const secret = await provider.getSecret(`gcsm://projects/${projectId}/secrets/test-json-secret/versions/latest::bar`);
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
        await expect(provider.getSecret(`gcsm://projects/${projectId}/secrets/test-json-secret/versions/latest::non-existent-key`))
            .rejects
            .toThrow(/Key non-existent-key not found in JSON object/);
    });

    it('should handle non-JSON secret with key specified', async () => {
        await expect(provider.getSecret(`gcsm://projects/${projectId}/secrets/test-plain-secret/versions/latest::some-key`))
            .rejects
            .toThrow(/Key some-key not found in JSON object/);
    });

    describe('Write operations', () => {
        it('should write a new secret to Google Cloud', async () => {
            const secretId = `test-write-secret-${Date.now()}`;
            const testValue = `test-value-${Date.now()}`;
            
            await provider.setSecret(`gcsm://projects/${projectId}/secrets/${secretId}/versions/latest`, testValue);
            
            const retrievedValue = await provider.getSecret(`gcsm://projects/${projectId}/secrets/${secretId}/versions/latest`);
            expect(retrievedValue).toBe(testValue);
        }, 15000);

        it('should add a new version to existing secret', async () => {
            const secretId = `test-update-secret-${Date.now()}`;
            const initialValue = `initial-${Date.now()}`;
            const updatedValue = `updated-${Date.now()}`;
            
            await provider.setSecret(`gcsm://projects/${projectId}/secrets/${secretId}/versions/latest`, initialValue);
            const firstRead = await provider.getSecret(`gcsm://projects/${projectId}/secrets/${secretId}/versions/latest`);
            expect(firstRead).toBe(initialValue);
            
            await provider.setSecret(`gcsm://projects/${projectId}/secrets/${secretId}/versions/latest`, updatedValue);
            
            // Wait for eventual consistency with exponential backoff
            let secondRead = await provider.getSecret(`gcsm://projects/${projectId}/secrets/${secretId}/versions/latest`);
            let retries = 0;
            let waitTime = 5000; // Start with 5 seconds
            const maxWaitTime = 60000; // Max 1 minute
            
            while (secondRead !== updatedValue && retries < 10) {
                await new Promise(resolve => setTimeout(resolve, waitTime));
                secondRead = await provider.getSecret(`gcsm://projects/${projectId}/secrets/${secretId}/versions/latest`);
                retries++;
                waitTime = Math.min(waitTime * 2, maxWaitTime); // Exponential backoff capped at 1 minute
            }
            
            expect(secondRead).toBe(updatedValue);
        }, 120000);

        it('should throw error for invalid write path format', async () => {
            await expect(provider.setSecret('invalid-path', 'value'))
                .rejects
                .toThrow('Invalid URI: invalid-path');
        });

        it('should handle JSON content in secret', async () => {
            const secretId = `test-json-write-${Date.now()}`;
            const jsonValue = JSON.stringify({ key: 'value', nested: { data: 'test' } });
            
            await provider.setSecret(`gcsm://projects/${projectId}/secrets/${secretId}/versions/latest`, jsonValue);
            
            const retrievedValue = await provider.getSecret(`gcsm://projects/${projectId}/secrets/${secretId}/versions/latest`);
            expect(retrievedValue).toBe(jsonValue);
            
            const parsedValue = JSON.parse(retrievedValue);
            expect(parsedValue.key).toBe('value');
            expect(parsedValue.nested.data).toBe('test');
        }, 15000);
    });
}); 