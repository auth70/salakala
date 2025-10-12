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
            .toThrow('Invalid URI: invalid-path');
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
            .toThrow(/Key non-existent-key not found in JSON object/);
    });

    it('should handle non-JSON secret with key specified', async () => {
        await expect(provider.getSecret(`awssm://${region}/test/test-plain-secret::some-key`))
            .rejects
            .toThrow(/Key some-key not found in JSON object/);
    });

    describe('Write operations', () => {
        it('should write a new secret to AWS', async () => {
            const secretId = `test/test-write-secret-${Date.now()}`;
            const testValue = `test-value-${Date.now()}`;
            
            await provider.setSecret(`awssm://${region}/${secretId}`, testValue);
            
            const retrievedValue = await provider.getSecret(`awssm://${region}/${secretId}`);
            expect(retrievedValue).toBe(testValue);
        }, 15000);

        it('should update an existing secret', async () => {
            const secretId = `test/test-update-secret-${Date.now()}`;
            const initialValue = `initial-${Date.now()}`;
            const updatedValue = `updated-${Date.now()}`;
            
            await provider.setSecret(`awssm://${region}/${secretId}`, initialValue);
            const firstRead = await provider.getSecret(`awssm://${region}/${secretId}`);
            expect(firstRead).toBe(initialValue);
            
            await provider.setSecret(`awssm://${region}/${secretId}`, updatedValue);
            const secondRead = await provider.getSecret(`awssm://${region}/${secretId}`);
            expect(secondRead).toBe(updatedValue);
        }, 15000);

        it('should throw error for invalid write path format', async () => {
            await expect(provider.setSecret('invalid-path', 'value'))
                .rejects
                .toThrow('Invalid URI: invalid-path');
        });
    });
});
