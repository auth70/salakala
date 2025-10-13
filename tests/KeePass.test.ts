import { describe, it, expect, beforeEach } from 'vitest';
import { KeePassProvider } from '../src/lib/providers/KeePass.js';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { keepassStaticData } from './fixtures/import-test-data.js';

describe('KeePassProvider', () => {
    let provider: KeePassProvider;
    const __dirname = fileURLToPath(new URL('.', import.meta.url));
    const testDbPath = join(__dirname, 'keepass.kdbx');

    beforeEach(() => {
        process.env.KEEPASS_PASSWORD = 'password';
        provider = new KeePassProvider();
    });

    it('should throw error for invalid path format', async () => {
        await expect(provider.getSecret('invalid-path'))
            .rejects
            .toThrow('Invalid URI: invalid-path');
    });

    it('should throw error for incomplete path', async () => {
        await expect(provider.getSecret(`kp://${testDbPath}`))
            .rejects
            .toThrow('Invalid KeePass path format');
    });

    it('should retrieve test entry username', async () => {
        const result = await provider.getSecret(`kp://${testDbPath}/test/UserName`);
        expect(result).toBe(keepassStaticData.testEntry.UserName);
    });

    it('should retrieve test entry password', async () => {
        const result = await provider.getSecret(`kp://${testDbPath}/test/Password`);
        expect(result).toBe(keepassStaticData.testEntry.Password);
    });

    it('should throw error for non-existent entry', async () => {
        await expect(provider.getSecret(`kp://${testDbPath}/non-existent/Password`))
            .rejects
            .toThrow('Entry \'non-existent\' not found');
    });

    it('should throw error for non-existent attribute', async () => {
        await expect(provider.getSecret(`kp://${testDbPath}/test/NonExistentAttribute`))
            .rejects
            .toThrow('unknown attribute NonExistentAttribute');
    });

    it('should retrieve JSON secret with :: syntax', async () => {
        const result = await provider.getSecret(`kp://${testDbPath}/json-test-entry/Notes::key`);
        expect(result).toBe(keepassStaticData.jsonTestEntry.Notes.key);
    });

    it('should retrieve nested JSON secret with :: syntax', async () => {
        const result = await provider.getSecret(`kp://${testDbPath}/json-test-entry/Notes::nested.value`);
        expect(result).toBe(keepassStaticData.jsonTestEntry.Notes.nested.value);
    });

    it('should throw on non-existent JSON key with :: syntax', async () => {
        await expect(provider.getSecret(`kp://${testDbPath}/json-test-entry/Notes::nonExistentKey`))
            .rejects
            .toThrow(/Key nonExistentKey not found in JSON object/);
    });

    describe('Write operations', () => {
        it('should throw error for invalid path format', async () => {
            await expect(provider.setSecret('invalid-path', 'value'))
                .rejects
                .toThrow('Invalid URI: invalid-path');
        });

        it('should throw error for path with too few parts', async () => {
            await expect(provider.setSecret('kp://db.kdbx/entry', 'value'))
                .rejects
                .toThrow('KeePass path must include database path, entry name, and attribute');
        });

        it('should throw error when trying to delete non-existent entry', async () => {
            await expect(provider.deleteSecret(`kp://${testDbPath}/non-existent-entry/Password`))
                .rejects
                .toThrow();
        }, 10000);
    });

    describe('buildPath', () => {
        it('should build correct path with database, entry, and field', () => {
            const path = provider.buildPath(
                { dbPath: '/path/to/db.kdbx', entry: 'GitHub' },
                { fieldName: 'Password' }
            );
            expect(path).toBe('kp:///path/to/db.kdbx/GitHub/Password');
        });

        it('should use default field name if not provided', () => {
            const path = provider.buildPath({
                dbPath: '/Users/test/secrets.kdbx',
                entry: 'MyEntry'
            });
            expect(path).toBe('kp:///Users/test/secrets.kdbx/MyEntry/Password');
        });

        it('should handle relative paths', () => {
            const path = provider.buildPath(
                { dbPath: './secrets.kdbx', entry: 'Web/GitHub' },
                { fieldName: 'UserName' }
            );
            expect(path).toBe('kp://./secrets.kdbx/Web/GitHub/UserName');
        });
    });
}); 