import { execSync } from 'child_process';
import { SecretProvider } from '../SecretProvider.js';
import { CliHandler } from '../CliHandler.js';

type BitwardenFolder = {
    id: string | null;
    name: string;
}

type BitwardenItem = {
    id: string;
    name: string;
    path?: string;
    type: number; // 1 = login, 2 = secure note
    notes?: string;
    folderId?: string;
    fields?: {
        name: string;
        value: string;
        type: number;
        linkedId: string | null;
    }[];
    login?: {
        username: string;
        password: string;
        uris?: {
            uri: string;
            match: string | null;
        }[];
    }
}

/**
 * Provider for accessing secrets stored in Bitwarden using the Bitwarden CLI (bw).
 * This implementation requires the Bitwarden CLI to be installed and configured.
 * 
 * Authentication is handled via:
 * - API key (BW_CLIENTID and BW_CLIENTSECRET environment variables)
 * - Session token (cached after successful authentication)
 * - Interactive unlock (if neither of the above is available)
 * 
 * @implements {SecretProvider}
 * @see {@link https://bitwarden.com/help/cli/} for Bitwarden CLI documentation
 */
export class BitwardenProvider extends SecretProvider {
    private sessionKey: string | null = null;
    private cli: CliHandler;
    private folders: BitwardenFolder[] = [];
    private items: BitwardenItem[] = [];
    constructor() { 
        super();
        this.cli = new CliHandler();
    }

    /**
     * Retrieves the list of items from Bitwarden.
     * @returns {Promise<BitwardenItem[]>} A promise that resolves to an array of Bitwarden items.
     */
    async getItems(): Promise<BitwardenItem[]> {
        if(this.items.length > 0) {
            return this.items;
        }
        await this.tryLogin();
        await this.getFolders();
        const response = await this.cli.run(`bw list items --session="${this.sessionKey}"`);
        if(response.state !== 'ok') {
            throw new Error(response.message || 'Unable to run bw list items');
        }
        try {
            this.items = (JSON.parse(response.stdout) as BitwardenItem[]).map((item) => {
                if(item.folderId) {
                    item.path = `${this.folders.find((folder) => folder.id === item.folderId)?.name}/${item.name}`;
                } else {
                    item.path = item.name;
                }
                return item;
            });
        } catch (e) {
            console.error('Error parsing Bitwarden items', e);
            throw new Error('Unable to parse Bitwarden items');
        }
        return this.items;
    }

    /**
     * Retrieves a specific secret from Bitwarden.
     * @param {string} path - The path to the secret.
     * @returns {Promise<string>} A promise that resolves to the secret.
     */
    async getSecret(path: string): Promise<string> {
        await this.getItems();
        const parsedPath = this.parsePath(path);
        if(parsedPath.pathParts.length < 2) {
            throw new Error(`Bitwarden path must be in the format: bw://folder_id_or_name/item_id_or_name/field_name[:JSON_key]`);
        }
        let itemPath = '';
        let fieldPath = '';
        if(parsedPath.pathParts.length === 2) {
            itemPath = parsedPath.pathParts[0];
            fieldPath = parsedPath.pathParts[1];
        } else if(parsedPath.pathParts.length === 3) {
            if(this.folders.find((folder) => folder.name === parsedPath.pathParts[0])) {
                itemPath = parsedPath.pathParts.slice(0, -1).join('/');
                fieldPath = parsedPath.pathParts[2];
            } else {
                itemPath = parsedPath.pathParts.slice(0, -2).join('/');
                fieldPath = parsedPath.pathParts[1];
            }
        } else {
            itemPath = parsedPath.pathParts.slice(0, -2).join('/');
            fieldPath = parsedPath.pathParts[1];
        }
        const item = this.items.find((item) => item.id === itemPath || item.path === itemPath);
        let foundValue = null;
        if(!item) {
            throw new Error(`No item found with ID or name: ${itemPath}`);
        }
        // First check the fields
        const field = item.fields?.find((field) => field.name === fieldPath);
        if(field) {
            foundValue = field.value;
        }
        // Check the login:
        // Format: bw://item_id_or_name/username
        else if(item.login && fieldPath === 'username') {
            foundValue = item.login.username;
        }
        // Format: bw://item_id_or_name/password
        else if(item.login && fieldPath === 'password') {
            foundValue = item.login.password;
        }
        // Check the notes
        else if(item.notes && fieldPath === 'notes') {
            foundValue = item.notes;
        }
        // Then check the uris:
        // Format: bw://item_id_or_name/uris/number
        else if(
            (parsedPath.pathParts.length === 3 && parsedPath.pathParts[1].includes('uris')) ||
            (parsedPath.pathParts.length === 4 && parsedPath.pathParts[2].includes('uris')) // for folder items
        ) {
            const uri = item.login?.uris?.[parseInt(parsedPath.pathParts[2])];
            if(uri) {
                foundValue = uri.uri;
            }
        }
        // If it's a secure note, return the notes
        else if(item.type === 2 && item.notes) {
            foundValue = item.notes;
        }

        if(foundValue) {
            return this.returnPossibleJsonValue(foundValue, parsedPath.jsonKey);
        }
        throw new Error(`No field found with name: ${parsedPath.pathParts[1]}`);
    }

    /**
     * Tries to login to Bitwarden using the API key or via interactive login.
     * Sets the session key in the provider when successful.
     * @returns {Promise<void>} A promise that resolves when the login is successful.
     */
    async tryLogin() {
        if(process.env.BW_CLIENTID && process.env.BW_CLIENTSECRET && process.env.BW_PASSWORD) {
            await this.cli.run('bw logout');
            if(process.env.BW_SERVER) {
                const serverResponse = await this.cli.run(`bw config server ${process.env.BW_SERVER}`);
                if(serverResponse.state !== 'ok') {
                    throw new Error(serverResponse.error?.message || serverResponse.message || 'Unable to run bw config server');
                }
            }
            const loginResponse = await this.cli.run(`bw login --apikey`, { env: {
                BW_CLIENTID: process.env.BW_CLIENTID,
                BW_CLIENTSECRET: process.env.BW_CLIENTSECRET,
            } });
            if(loginResponse.state !== 'ok' || !loginResponse.stdout.includes("You are logged in")) {
                throw new Error(loginResponse.error?.message || loginResponse.message || 'Unable to run bw login');
            }
            const sessionResponse = await this.cli.run(`bw unlock --passwordenv BW_PASSWORD --raw`, {
                env: {
                    BW_PASSWORD: process.env.BW_PASSWORD
                }
            });
            if(sessionResponse.state !== 'ok') {
                throw new Error(sessionResponse.error?.message || sessionResponse.message || 'Unable to run bw unlock');
            }
            this.sessionKey = sessionResponse.stdout;
        } else {
            console.log('🔒🐟 No BW_CLIENTID, BW_CLIENTSECRET, or BW_PASSWORD found, trying interactive login');
            // Check login status
            const loginStatusResponse = await this.cli.run('bw login --check');
            if(loginStatusResponse.state !== 'ok' || !loginStatusResponse.stdout.includes("You are logged in")) {
                // Try to login
                console.log('🔒🐟 Trying to login. You are interacting with Bitwarden CLI now.');
                const loginResponse = await this.cli.run('bw login --raw', { interactive: true });
                if(loginResponse.state !== 'ok') {
                    throw new Error(loginResponse.error?.message || loginResponse.message || 'Unable to run bw login');
                }
                this.sessionKey = loginResponse.stdout;
            } else {
                // Unlock
                console.log('🔒🐟 Unlocking session. You are interacting with Bitwarden CLI now.');
                const sessionResponse = await this.cli.run('bw unlock --raw', { interactive: true });
                if(sessionResponse.state !== 'ok') {
                    throw new Error(sessionResponse.error?.message || sessionResponse.message || 'Unable to run bw unlock');
                }
                this.sessionKey = sessionResponse.stdout;
            }
        }
    }

    async getFolders(): Promise<BitwardenFolder[]> {
        if(this.folders.length > 0) {
            return this.folders;
        }
        const response = await this.cli.run(`bw list folders --session="${this.sessionKey}"`);
        if(response.state !== 'ok') {
            throw new Error(response.error?.message || response.message || 'Unable to run bw list folders');
        }
        this.folders = JSON.parse(response.stdout) as BitwardenFolder[];
        return this.folders;
    }

}