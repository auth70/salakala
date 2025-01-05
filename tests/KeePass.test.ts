import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KeePassProvider } from '../src/lib/providers/KeePass.js';
import { execSync } from 'child_process';

vi.mock('child_process');

describe('KeePassProvider', () => {
    let provider: KeePassProvider;

    beforeEach(() => {
        vi.clearAllMocks();
        provider = new KeePassProvider();
    });

    it('should throw error for invalid path format', async () => {
        await expect(provider.getSecret('invalid-path'))
            .rejects
            .toThrow('Invalid KeePass secret path');
    });

    it('should throw error for incomplete path', async () => {
        await expect(provider.getSecret('kp:///path/to/database.kdbx'))
            .rejects
            .toThrow('Invalid KeePass path format');
    });

    it('should retrieve secret successfully on first try', async () => {
        vi.mocked(execSync).mockReturnValueOnce('test-secret-value\n');

        const result = await provider.getSecret('kp:///path/to/database.kdbx/entry/UserName');
        
        expect(result).toBe('test-secret-value');
        expect(execSync).toHaveBeenCalledWith(
            'keepassxc-cli show -a UserName "/path/to/database.kdbx" "entry"',
            expect.objectContaining({
                stdio: ['ignore', 'pipe', 'pipe']
            })
        );
    });

    it('should retry with password prompt on first failure', async () => {
        // First call fails (no key file/password)
        vi.mocked(execSync).mockImplementationOnce(() => {
            throw new Error('No password or keyfile');
        });
        
        // Second attempt with password prompt succeeds
        vi.mocked(execSync).mockReturnValueOnce('test-secret-value\n');

        const result = await provider.getSecret('kp:///path/to/database.kdbx/entry/Password');
        
        expect(result).toBe('test-secret-value');
        
        // First attempt should not inherit stdin
        expect(execSync).toHaveBeenNthCalledWith(1,
            'keepassxc-cli show -a Password "/path/to/database.kdbx" "entry"',
            expect.objectContaining({
                stdio: ['ignore', 'pipe', 'pipe']
            })
        );
        
        // Second attempt should inherit stdin for password prompt
        expect(execSync).toHaveBeenNthCalledWith(2,
            'keepassxc-cli show -a Password "/path/to/database.kdbx" "entry"',
            expect.objectContaining({
                stdio: ['inherit', 'pipe', 'inherit']
            })
        );
    });

    it('should handle empty secret value', async () => {
        vi.mocked(execSync).mockReturnValueOnce('');

        await expect(provider.getSecret('kp:///path/to/database.kdbx/entry/UserName'))
            .rejects
            .toThrow('No value returned for attribute \'UserName\' in entry \'entry\'');
    });

    it('should handle password prompt failure', async () => {
        // First call fails (no key file/password)
        vi.mocked(execSync).mockImplementationOnce(() => {
            throw new Error('No password or keyfile');
        });
        
        // Second attempt with password prompt also fails
        vi.mocked(execSync).mockImplementationOnce(() => {
            throw new Error('Wrong password');
        });

        await expect(provider.getSecret('kp:///path/to/database.kdbx/entry/Password'))
            .rejects
            .toThrow('Failed to read KeePass secret: Wrong password');
    });
}); 