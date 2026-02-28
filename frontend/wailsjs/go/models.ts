export namespace domain {
	
	export class AppSettings {
	    autoexecPath: string;
	    reloadCommand: string;
	    reloadBindKey: string;
	    favoriteKeys: Record<string, boolean>;
	    recentKeys: string[];
	    updatedAt: number;
	
	    static createFrom(source: any = {}) {
	        return new AppSettings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.autoexecPath = source["autoexecPath"];
	        this.reloadCommand = source["reloadCommand"];
	        this.reloadBindKey = source["reloadBindKey"];
	        this.favoriteKeys = source["favoriteKeys"];
	        this.recentKeys = source["recentKeys"];
	        this.updatedAt = source["updatedAt"];
	    }
	}
	export class BindConflict {
	    key: string;
	    kind: string;
	    description: string;
	
	    static createFrom(source: any = {}) {
	        return new BindConflict(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.key = source["key"];
	        this.kind = source["kind"];
	        this.description = source["description"];
	    }
	}
	export class BindEntry {
	    key: string;
	    mode: string;
	    message: string;
	    commandRaw: string;
	    parseable: boolean;
	    source: string;
	    favorite: boolean;
	    recent: boolean;
	    updatedAt: number;
	    emojis: string[];
	    previewText: string;
	
	    static createFrom(source: any = {}) {
	        return new BindEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.key = source["key"];
	        this.mode = source["mode"];
	        this.message = source["message"];
	        this.commandRaw = source["commandRaw"];
	        this.parseable = source["parseable"];
	        this.source = source["source"];
	        this.favorite = source["favorite"];
	        this.recent = source["recent"];
	        this.updatedAt = source["updatedAt"];
	        this.emojis = source["emojis"];
	        this.previewText = source["previewText"];
	    }
	}
	export class AutoexecSnapshot {
	    path: string;
	    exists: boolean;
	    managedBlock: boolean;
	    managedBinds: BindEntry[];
	    allBinds: BindEntry[];
	    conflicts: BindConflict[];
	    lastModified: number;
	    fingerprint: string;
	
	    static createFrom(source: any = {}) {
	        return new AutoexecSnapshot(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.exists = source["exists"];
	        this.managedBlock = source["managedBlock"];
	        this.managedBinds = this.convertValues(source["managedBinds"], BindEntry);
	        this.allBinds = this.convertValues(source["allBinds"], BindEntry);
	        this.conflicts = this.convertValues(source["conflicts"], BindConflict);
	        this.lastModified = source["lastModified"];
	        this.fingerprint = source["fingerprint"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	export class DashboardState {
	    settings: AppSettings;
	    snapshot: AutoexecSnapshot;
	    emojiCount: number;
	    reloadSamples: string[];
	    lastSyncAt: number;
	
	    static createFrom(source: any = {}) {
	        return new DashboardState(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.settings = this.convertValues(source["settings"], AppSettings);
	        this.snapshot = this.convertValues(source["snapshot"], AutoexecSnapshot);
	        this.emojiCount = source["emojiCount"];
	        this.reloadSamples = source["reloadSamples"];
	        this.lastSyncAt = source["lastSyncAt"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class EmojiItem {
	    code: number;
	    name: string;
	    chatCode: string;
	    unicode: string;
	    unicodeEscape: string;
	    gifUrl: string;
	    gifFile: string;
	    tags: string[];
	    source: string[];
	
	    static createFrom(source: any = {}) {
	        return new EmojiItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.code = source["code"];
	        this.name = source["name"];
	        this.chatCode = source["chatCode"];
	        this.unicode = source["unicode"];
	        this.unicodeEscape = source["unicodeEscape"];
	        this.gifUrl = source["gifUrl"];
	        this.gifFile = source["gifFile"];
	        this.tags = source["tags"];
	        this.source = source["source"];
	    }
	}
	export class EmojiCatalog {
	    generatedAt: string;
	    items: EmojiItem[];
	
	    static createFrom(source: any = {}) {
	        return new EmojiCatalog(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.generatedAt = source["generatedAt"];
	        this.items = this.convertValues(source["items"], EmojiItem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class UpdateSettingsRequest {
	    autoexecPath?: string;
	    reloadCommand?: string;
	    reloadBindKey?: string;
	
	    static createFrom(source: any = {}) {
	        return new UpdateSettingsRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.autoexecPath = source["autoexecPath"];
	        this.reloadCommand = source["reloadCommand"];
	        this.reloadBindKey = source["reloadBindKey"];
	    }
	}
	export class UpsertBindRequest {
	    oldKey: string;
	    key: string;
	    mode: string;
	    message: string;
	
	    static createFrom(source: any = {}) {
	        return new UpsertBindRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.oldKey = source["oldKey"];
	        this.key = source["key"];
	        this.mode = source["mode"];
	        this.message = source["message"];
	    }
	}

}

