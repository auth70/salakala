import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OnePasswordProvider } from '../src/lib/providers/1Password.js';

describe('OnePasswordProvider', () => {
    let provider: OnePasswordProvider;
    const createdItems: string[] = [];

    beforeEach(() => {
        if (!process.env.OP_SERVICE_ACCOUNT_TOKEN) {
            throw new Error('OP_SERVICE_ACCOUNT_TOKEN environment variable must be set');
        }
        provider = new OnePasswordProvider();
    });

    afterEach(async () => {
        for (const itemPath of createdItems) {
            try {
                await provider.deleteSecret(itemPath);
            } catch (error) {
                console.error('Error deleting 1Password item', error);
                // Ignore errors during cleanup
            }
        }
        createdItems.length = 0;
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

    it('should retrieve JSON secret with :: syntax', async () => {
        const result = await provider.getSecret('op://testing/test-json/notes::key');
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
        expect(result).toBe('test-json-value');
    });

    it('should retrieve nested JSON secret with :: syntax', async () => {
        const result = await provider.getSecret('op://testing/test-json/notes::nested.value');
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
        expect(result).toBe('nested-test-value');
    });

    it('should throw on non-existent JSON key with :: syntax', async () => {
        await expect(provider.getSecret('op://testing/test-json/notes::nonExistentKey'))
            .rejects
            .toThrow(/Key nonExistentKey not found in JSON object/);
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

    describe('Write operations', () => {
        it('should write a secret to 1Password', async () => {
            const timestamp = Date.now();
            const itemName = `test-write-item-${timestamp}`;
            const testValue = `test-value-${timestamp}`;
            createdItems.push(`op://testing/${itemName}/password`);
            
            await provider.setSecret(`op://testing/${itemName}/password`, testValue);
            
            const retrievedValue = await provider.getSecret(`op://testing/${itemName}/password`);
            expect(retrievedValue).toBe(testValue);
        }, 15000);

        it('should update an existing secret', async () => {
            const timestamp = Date.now();
            const itemName = `test-update-item-${timestamp}`;
            const initialValue = `initial-${timestamp}`;
            const updatedValue = `updated-${timestamp}`;
            createdItems.push(`op://testing/${itemName}/password`);
            
            await provider.setSecret(`op://testing/${itemName}/password`, initialValue);
            const firstRead = await provider.getSecret(`op://testing/${itemName}/password`);
            expect(firstRead).toBe(initialValue);
            
            // Add small delay to avoid 409 conflicts from rapid updates
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            await provider.setSecret(`op://testing/${itemName}/password`, updatedValue);
            const secondRead = await provider.getSecret(`op://testing/${itemName}/password`);
            expect(secondRead).toBe(updatedValue);
        }, 20000);

        it('should throw error for invalid write path', async () => {
            await expect(provider.setSecret('invalid-path', 'value'))
                .rejects
                .toThrow('Invalid 1Password secret path');
        });

        it('should throw error for path without field name', async () => {
            await expect(provider.setSecret('op://testing/item', 'value'))
                .rejects
                .toThrow('1Password path must include a field name');
        });

        it('should delete a secret', async () => {
            const timestamp = Date.now();
            const itemName = `test-delete-item-${timestamp}`;
            const testValue = `value-to-delete-${timestamp}`;
            
            await provider.setSecret(`op://testing/${itemName}/password`, testValue);
            
            // Add small delay to ensure item is fully created before deletion
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            await provider.deleteSecret(`op://testing/${itemName}/password`);
            
            await expect(provider.getSecret(`op://testing/${itemName}/password`))
                .rejects
                .toThrow();
        }, 20000);
    });
}); 