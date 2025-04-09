import { execSync } from 'child_process';
import { SecretProvider } from '../SecretProvider.js';
import { CliHandler } from '../CliHandler.js';
import inquirer from 'inquirer';

/*
[
  {
    "id": "6754388171590937865",
    "name": "test",
    "fullname": "test-folder/test",
    "username": "testuser",
    "password": "testpassword",
    "last_modified_gmt": "1736306225",
    "last_touch": "0",
    "group": "test-folder",
    "url": "http://google.com",
    "note": "{\"foo\":\"bar\",\"baz\":{\"lorem\":[\"ipsum\",\"dolor\"]}}" 
  } 
] 
*/
type LastPassItem = {
    id: string;
    name: string;
    fullname: string;
    username?: string;
    password?: string;
    group?: string;
    url?: string;
    note?: string;
}

/**
 * Provider for accessing secrets stored in LastPass using the LastPass CLI (lpass).
 * This implementation requires the LastPass CLI to be installed and configured.
 * 
 * The authentication state is cached after the first successful login
 * and reused for subsequent requests until the program terminates.
 * 
 * @implements {SecretProvider}
 * @see {@link https://github.com/lastpass/lastpass-cli} for LastPass CLI documentation
 */
export class LastPassProvider extends SecretProvider {
    /**
     * Flag indicating whether we have successfully logged in in this session.
     * @private
     */
    private isLoggedIn: boolean = false;
    private cli: CliHandler;
    private folders: string[] = [];

    constructor() {
        super();
        this.cli = new CliHandler();
    }

    async checkLogin() {
        const result = await this.cli.run('lpass status');
        if(result.state !== "ok" && result.state !== 'error') {
            throw new Error(result.error?.message || result.message || 'Unable to run lpass status');
        }
        if(result.stdout.includes('Not logged in')) {
            this.isLoggedIn = false;
            console.log('❌ LastPass CLI is not logged in.');
            await this.tryLogin();
        } else if(result.stdout.includes('Logged in as')) {
            this.isLoggedIn = true;
            console.log('✅ LastPass CLI is logged in.');
        } else {
            console.error(result);
            throw new Error('Failed to parse lpass status output');
        }
    }

    /* 
% lpass ls -l --color=never
(none)/test [id: 6189975547628296505]
(none)/top-level-secure-note [id: 9120810406532001297]
custom-field-test-folder/custom-field-test [id: 6922534590124668849]
test-folder/test [id: 6754388171590937865]
     */
    async getItems(): Promise<{ path: string, id: string }[]> {
        const result = await this.cli.run('lpass ls --color=never');
        const lines = result.stdout.split('\n').filter(line => line.trim() !== '');
        return lines.map(line => {
            const match = line.match(/^(.+)\/(.+)\s+\[id: (\d+)\]/);
            if(!match) {
                return null;
            }
            let [, folder, itemName, id] = match;
            if(folder === '(none)') {
                folder = '';
            } else {
                folder += '/';
            }
            return {path: `${folder}${itemName}`, id};
        }).filter((m): m is { path: string, id: string } => m !== null);
    }

    async tryLogin() {
        console.log('The LastPass CLI needs your username to be passed in as an argument when logging in. Please enter it now.');
        const promptResult = await inquirer.prompt({
            type: 'input',
            name: 'username',
            message: 'Enter your LastPass username:',
        });
        console.log('🔑 LastPass needs to login. You are interacting with LastPass CLI now.');
        const result = await this.cli.run(`lpass login ${promptResult.username}`, {
            interactive: true,
        });
        if(result.state !== 'ok') {
            throw new Error(result.error?.message || result.message || 'Unable to run lpass login');
        }
        if(result.stdout.includes('Logged in as')) {
            this.isLoggedIn = true;
        } else if(result.stdout.includes('Failed to enter correct password')) {
            throw new Error('Failed to enter correct password');
        } else {
            console.error(result);
            throw new Error('Failed to parse lpass login output');
        }
    }

    /**
     * Retrieves a secret value from LastPass using the CLI.
     * 
     * @param {string} path - The LastPass secret reference path
     *                        Format: lp://group/item-name[/field]
     *                        Example: lp://Development/API Keys/password
     * @returns {Promise<string>} The secret value
     * @throws {Error} If the path is invalid, authentication fails, or secret cannot be retrieved
     */
    async getSecret(path: string): Promise<string> {

        await this.checkLogin();

        const parsedPath = this.parsePath(path);
        const items = await this.getItems();
        let queryPath = parsedPath.path;

        if(parsedPath.pathParts.length === 3) {
            path = parsedPath.pathParts[0] + '/' + parsedPath.pathParts[1];
        }

        console.log('queryPath ', queryPath);
        console.log('path ', path);
        console.log('items ', items);

        const item = items.find(item => item.path === queryPath);
        if(!item) {
            throw new Error(`Item '${path}' not found`);
        }
        const itemId = item.id;

        const result = await this.cli.run(`lpass show --all -j "${itemId}"`);
        if(result.state !== 'ok') {
            throw new Error(result.error?.message || result.message || `Unable to run lpass show for path '${path}'`);
        }
        const json = JSON.parse(result.stdout) as LastPassItem[];
        console.log('json ', json);
        if(json.length === 0) {
            throw new Error(`No secret found at path '${path}'`);
        }
        return json[0].password!;
    }

} 