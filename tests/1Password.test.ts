import { describe, it, expect, beforeEach } from 'vitest';
import { OnePasswordProvider } from '../src/lib/providers/1Password.js';

describe('OnePasswordProvider', () => {
    let provider: OnePasswordProvider;

    beforeEach(() => {
        if (!process.env.OP_SERVICE_ACCOUNT_TOKEN) {
            throw new Error('OP_SERVICE_ACCOUNT_TOKEN environment variable must be set');
        }
        provider = new OnePasswordProvider();
    });

    it('should throw error for invalid path format', async () => {
        await expect(provider.getSecret('invalid-path'))
            .rejects
            .toThrow('Invalid 1Password secret path');
    });

    it('should retrieve secret successfully', async () => {
        const result = await provider.getSecret('op://testing/test-item/password');
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
        expect(result).toBe('test-secret-value');
    });

    it('should retrieve JSON secret field', async () => {
        const result = await provider.getSecret('op://testing/test-json/api-key');
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
        expect(result).toBe('json-test-value');
    });

    it('should throw on non-existent vault', async () => {
        await expect(provider.getSecret('op://non-existent-vault/item/field'))
            .rejects
            .toThrow(/Failed to read 1Password secret/);
    });

    it('should throw on non-existent item', async () => {
        await expect(provider.getSecret('op://testing/non-existent-item/field'))
            .rejects
            .toThrow(/Failed to read 1Password secret/);
    });

    it('should throw on non-existent field', async () => {
        await expect(provider.getSecret('op://testing/test-item/non-existent-field'))
            .rejects
            .toThrow(/Failed to read 1Password secret/);
    });
}); 