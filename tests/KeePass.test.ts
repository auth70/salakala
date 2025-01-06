import { describe, it, expect, beforeEach } from 'vitest';
import { KeePassProvider } from '../src/lib/providers/KeePass.js';
import { join } from 'path';
import { fileURLToPath } from 'url';

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
            .toThrow('Invalid KeePass secret path');
    });

    it('should throw error for incomplete path', async () => {
        await expect(provider.getSecret(`kp://${testDbPath}`))
            .rejects
            .toThrow('Invalid KeePass path format');
    });

    it('should retrieve test entry username', async () => {
        const result = await provider.getSecret(`kp://${testDbPath}/test/UserName`);
        expect(result).toBe('test');
    });

    it('should retrieve test entry password', async () => {
        const result = await provider.getSecret(`kp://${testDbPath}/test/Password`);
        expect(result).toBe('testtest');
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
}); 