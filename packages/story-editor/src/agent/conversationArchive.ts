import type { AgentMessage } from "@moesekai/story-agent/browser";
import type { AgentTurn } from "./agentTurns";

/** One conversation with the agent about a story, as kept between visits. */
export interface StoredConversation {
    id: string;
    /** The story it is about (a draft id). */
    storyKey: string;
    /** The first request, for the history list. */
    title: string;
    updatedAt: number;
    /** What the panel shows. */
    turns: AgentTurn[];
    /** What the model sees: the transcript, compacted. */
    transcript: AgentMessage[];
}

/** Where conversations are kept. */
export interface ConversationArchive {
    /** A story's conversations, most recent first. */
    list(storyKey: string): Promise<StoredConversation[]>;
    save(conversation: StoredConversation): Promise<void>;
    remove(id: string): Promise<void>;
}

const byRecency = (a: StoredConversation, b: StoredConversation) => b.updatedAt - a.updatedAt;

/** Conversations kept for the life of the page (tests, or a browser without IndexedDB). */
export function createMemoryConversationArchive(): ConversationArchive {
    const conversations = new Map<string, StoredConversation>();
    return {
        async list(storyKey) {
            return [...conversations.values()].filter(c => c.storyKey === storyKey).sort(byRecency);
        },
        async save(conversation) {
            conversations.set(conversation.id, conversation);
        },
        async remove(id) {
            conversations.delete(id);
        },
    };
}

const DB_NAME = "moesekai-story-agent";
const STORE = "conversations";
const STORY_INDEX = "storyKey";

function request<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function openDatabase(): Promise<IDBDatabase> {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => {
        open.result.createObjectStore(STORE, { keyPath: "id" }).createIndex(STORY_INDEX, STORY_INDEX);
    };
    return request(open);
}

/** Conversations kept in this browser's IndexedDB (`moesekai-story-agent`). */
export function createIndexedDbConversationArchive(): ConversationArchive {
    let database: Promise<IDBDatabase> | null = null;
    const store = async (mode: IDBTransactionMode) => {
        database ??= openDatabase();
        return (await database).transaction(STORE, mode).objectStore(STORE);
    };
    return {
        async list(storyKey) {
            const found = await request((await store("readonly")).index(STORY_INDEX).getAll(storyKey));
            return (found as StoredConversation[]).sort(byRecency);
        },
        async save(conversation) {
            await request((await store("readwrite")).put(conversation));
        },
        async remove(id) {
            await request((await store("readwrite")).delete(id));
        },
    };
}

/** IndexedDB when the browser has it, else memory. */
export function createDefaultConversationArchive(): ConversationArchive {
    return typeof indexedDB === "undefined" ? createMemoryConversationArchive() : createIndexedDbConversationArchive();
}
