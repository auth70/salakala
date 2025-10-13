import { execSync } from 'child_process';
import { SecretProvider, PathComponentType } from '../SecretProvider.js';
import { CliHandler } from '../CliHandler.js';
import { EMOJI } from '../constants.js';

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
    readonly supportsMultipleFields = true;
    readonly pathComponents = [
        { name: 'folder', type: PathComponentType.Folder, description: 'Folder name (optional)', required: false },
        { name: 'item', type: PathComponentType.Item, description: 'Item name', required: true },
    ];

    private sessionKey: string | null = null;
    private cli: CliHandler;
    private folders: BitwardenFolder[] = [];
    private items: BitwardenItem[] = [];
    
    constructor() { 
        super();
        this.cli = new CliHandler();
    }

    buildPath(components: Record<string, string>, opts?: { fieldName?: string }): string {
        const { folder, item } = components;
        const fieldName = opts?.fieldName || 'password';
        
        if (folder) {
            return `bw://${folder}/${item}/${fieldName}`;
        }
        return `bw://${item}/${fieldName}`;
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
     * 
     * Supported path formats:
     * - bw://item/field - Item without folder
     * - bw://folder/item/field - Item in a folder
     * 
     * @param {string} path - The path to the secret
     * @returns {Promise<string>} A promise that resolves to the secret
     */
    async getSecret(path: string): Promise<string> {
        await this.getItems();
        const parsedPath = this.parsePath(path);
        if(parsedPath.pathParts.length < 2) {
            throw new Error(`Bitwarden path must be in the format: bw://[folder/]item/field[::jsonKey]`);
        }

        // Determine item path and field based on path structure
        const { itemPath, fieldPath } = this.parseItemPath(parsedPath.pathParts);
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
            // If we already have a session key, don't re-login
            if (this.sessionKey) {
                return;
            }
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
            // Check login status
            const loginStatusResponse = await this.cli.run('bw login --check');
            if(loginStatusResponse.state !== 'ok' || !loginStatusResponse.stdout.includes("You are logged in")) {
                // Try to login
                console.log(`${EMOJI.LOGIN} Bitwarden needs to login. You are interacting with Bitwarden CLI now.`);
                const loginResponse = await this.cli.run('bw login --raw', {
                    interactive: true,
                    passwordPrompt: 'Master password'
                });
                if(loginResponse.state !== 'ok') {
                    throw new Error(loginResponse.error?.message || loginResponse.message || 'Unable to run bw login');
                }
                this.sessionKey = loginResponse.stdout;
            } else {
                // Unlock
                console.log(`${EMOJI.LOGIN} Bitwarden needs to unlock your session. You are interacting with Bitwarden CLI now.`);
                const sessionResponse = await this.cli.run('bw unlock --raw', {
                    interactive: true,
                    passwordPrompt: 'Master password'
                });
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

    /**
     * Parses Bitwarden path parts into item path and field path.
     * 
     * @param {string[]} pathParts - The path parts from the URI
     * @returns {{ itemPath: string, fieldPath: string }} The parsed paths
     * @private
     */
    private parseItemPath(pathParts: string[]): { itemPath: string, fieldPath: string } {
        if (pathParts.length === 2) {
            // Format: bw://item/field
            return {
                itemPath: pathParts[0],
                fieldPath: pathParts[1]
            };
        } else {
            // Format: bw://folder/item/field
            // Check if first part is a folder
            const hasFolder = this.folders.some(folder => folder.name === pathParts[0]);
            if (hasFolder) {
                return {
                    itemPath: pathParts.slice(0, -1).join('/'),
                    fieldPath: pathParts[pathParts.length - 1]
                };
            } else {
                // First part is not a folder, treat as item name
                return {
                    itemPath: pathParts[0],
                    fieldPath: pathParts[1]
                };
            }
        }
    }

    /**
     * Stores a secret value in Bitwarden.
     * Creates a new item if it doesn't exist, or updates an existing field.
     * 
     * @param {string} path - The Bitwarden secret reference path
     *                        Format: bw://[folder]/item-name/field
     *                        Example: bw://my-folder/api-creds/password
     * @param {string} value - The secret value to store
     * @returns {Promise<void>}
     * @throws {Error} If the path is invalid or secret cannot be written
     */
    async setSecret(path: string, value: string): Promise<void> {
        const parsedPath = this.parsePath(path);
        
        if (parsedPath.pathParts.length < 2) {
            throw new Error('Bitwarden path must include at least item name and field');
        }

        await this.getItems(); // Ensure we have items loaded
        
        let itemPath = '';
        let fieldName = '';
        
        if (parsedPath.pathParts.length === 2) {
            itemPath = parsedPath.pathParts[0];
            fieldName = parsedPath.pathParts[1];
        } else {
            itemPath = parsedPath.pathParts.slice(0, -1).join('/');
            fieldName = parsedPath.pathParts[parsedPath.pathParts.length - 1];
        }

        const item = this.items.find((item) => item.id === itemPath || item.path === itemPath);

        try {
            if (item) {
                // Update existing item
                console.log(`${EMOJI.UPDATING} Updating Bitwarden item ${itemPath}, field ${fieldName}...`);
                
                // Get full item data
                const getResponse = await this.cli.run(`bw get item ${item.id} --session="${this.sessionKey}"`);
                if (getResponse.state !== 'ok') {
                    throw new Error('Failed to get item for editing');
                }
                
                const itemData = JSON.parse(getResponse.stdout);
                
                // Update the appropriate field
                if (fieldName === 'password' && itemData.login) {
                    itemData.login.password = value;
                } else if (fieldName === 'username' && itemData.login) {
                    itemData.login.username = value;
                } else if (fieldName === 'notes') {
                    itemData.notes = value;
                } else {
                    // Update or create custom field
                    if (!itemData.fields) {
                        itemData.fields = [];
                    }
                    const field = itemData.fields.find((f: any) => f.name === fieldName);
                    if (field) {
                        field.value = value;
                    } else {
                        itemData.fields.push({
                            name: fieldName,
                            value: value,
                            type: 0 // text field
                        });
                    }
                }
                
                // Encode and update
                const itemJson = JSON.stringify(itemData);
                const encoded = Buffer.from(itemJson).toString('base64');
                const editResponse = await this.cli.run(`bw edit item ${item.id} ${encoded} --session="${this.sessionKey}"`);
                
                if (editResponse.state !== 'ok') {
                    throw new Error(editResponse.message || 'Failed to update item');
                }
                
                // Clear cache
                this.items = [];
            } else {
                // Create new item
                console.log(`${EMOJI.CREATING} Creating Bitwarden item ${itemPath}...`);
                
                const newItem: any = {
                    type: 1, // login type
                    name: parsedPath.pathParts[parsedPath.pathParts.length - 2] || parsedPath.pathParts[0],
                    login: {},
                    notes: null,
                    fields: []
                };
                
                // Set folder if applicable
                if (parsedPath.pathParts.length > 2) {
                    const folderName = parsedPath.pathParts[0];
                    const folder = this.folders.find((f) => f.name === folderName);
                    if (folder && folder.id) {
                        newItem.folderId = folder.id;
                    }
                }
                
                // Set the field value
                if (fieldName === 'password') {
                    newItem.login.password = value;
                } else if (fieldName === 'username') {
                    newItem.login.username = value;
                } else if (fieldName === 'notes') {
                    newItem.notes = value;
                } else {
                    newItem.fields.push({
                        name: fieldName,
                        value: value,
                        type: 0
                    });
                }
                
                const itemJson = JSON.stringify(newItem);
                const encoded = Buffer.from(itemJson).toString('base64');
                const createResponse = await this.cli.run(`bw create item ${encoded} --session="${this.sessionKey}"`);
                
                if (createResponse.state !== 'ok') {
                    throw new Error(createResponse.message || 'Failed to create item');
                }
                
                // Clear cache
                this.items = [];
            }
        } catch (error: unknown) {
            this.wrapProviderError(error, 'write', 'Bitwarden');
        }
    }

    /**
     * Deletes a secret from Bitwarden.
     * Deletes the entire item from the vault.
     * 
     * @param {string} path - The Bitwarden secret reference path
     *                        Format: bw://[folder]/item-name/field
     *                        Example: bw://my-folder/api-creds/password
     * @returns {Promise<void>}
     * @throws {Error} If the path is invalid or secret cannot be deleted
     */
    async deleteSecret(path: string): Promise<void> {
        const parsedPath = this.parsePath(path);
        
        if (parsedPath.pathParts.length < 2) {
            throw new Error('Bitwarden path must include at least item name and field');
        }

        await this.getItems();
        
        let itemPath = '';
        if (parsedPath.pathParts.length === 2) {
            itemPath = parsedPath.pathParts[0];
        } else {
            itemPath = parsedPath.pathParts.slice(0, -1).join('/');
        }

        const item = this.items.find((item) => item.id === itemPath || item.path === itemPath);

        if (!item) {
            throw new Error(`No item found with ID or name: ${itemPath}`);
        }

        try {
            console.log(`${EMOJI.DELETING} Deleting Bitwarden item ${itemPath}...`);
            const deleteResponse = await this.cli.run(`bw delete item ${item.id} --session="${this.sessionKey}"`);
            
            if (deleteResponse.state !== 'ok') {
                throw new Error(deleteResponse.message || 'Failed to delete item');
            }
            
            this.items = [];
        } catch (error: unknown) {
            this.wrapProviderError(error, 'delete', 'Bitwarden');
        }
    }

}