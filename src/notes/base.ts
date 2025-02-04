import { Blueprint } from 'ankibridge/blueprints/base'
import { NotesInfoResponseEntity } from 'ankibridge/entities/network'
import {
    AnkiFields,
    Media,
    ModelName,
    NoteField,
    NoteFields,
    SourceDescriptor,
} from 'ankibridge/entities/note'
import AnkiBridgePlugin from 'ankibridge/main'
import { getDefaultDeckForFolder } from 'ankibridge/utils/file'
import yup from 'ankibridge/utils/yup'
import { Type, load } from 'js-yaml'
import { get } from 'lodash'
import { App, Notice, getAllTags } from 'obsidian'
import { resolve } from 'path'

// Config
export interface Config {
    deck?: string
    tags?: Array<string>
    delete?: boolean
    enabled?: boolean
    cloze?: boolean
}

export interface ParseConfig extends Config {
    id: number | null
}
export class ParseConfig {
    public static async fromResult(result: ParseNoteResult): Promise<ParseConfig> {
        const configStr = result.config || ''
        const configObj: ParseConfig = <ParseConfig>load(configStr) || { id: null }

        const validatedConfig: ParseConfig = await ParseConfigSchema.validate(configObj)

        return validatedConfig
    }
}
export const ParseConfigSchema: yup.SchemaOf<ParseConfig> = yup.object({
    id: yup.number().nullable().defined().default(null),
    deck: yup.string().emptyAsUndefined().nullAsUndefined(),
    tags: yup.array().of(yup.string()).notRequired(),
    delete: yup.boolean().nullAsUndefined(),
    enabled: yup.boolean().nullAsUndefined(),
    cloze: yup.boolean().nullAsUndefined(),
})

// Location
export interface ParseLocationMarker {
    offset: number
    line: number
    column: number
}
export const ParseLocationMarkerSchema: yup.SchemaOf<ParseLocationMarker> = yup.object({
    offset: yup.number().defined(),
    line: yup.number().defined(),
    column: yup.number().defined(),
})

export interface ParseLocation {
    start: ParseLocationMarker
    end: ParseLocationMarker
    source?: string
}
export const ParseLocationSchema: yup.SchemaOf<ParseLocation> = yup.object({
    start: ParseLocationMarkerSchema,
    end: ParseLocationMarkerSchema,
    source: yup.string(),
})

// Result
export interface ParseLineResult {
    type: string
    text: string
}

export const ParseLineResultSchema: yup.SchemaOf<ParseLineResult> = yup.object({
    type: yup.string().defined(),
    text: yup.string().defined(),
})

export interface ParseNoteResult {
    type: string
    config: string | null
    front: string | null
    back: string | null
    location: ParseLocation
}
export const ParseNoteResultSchema: yup.SchemaOf<ParseNoteResult> = yup.object({
    type: yup.string().defined(),
    config: yup.string().nullable().defined(),
    front: yup.string().nullable().defined(),
    back: yup.string().nullable().defined(),
    location: ParseLocationSchema,
})

export abstract class NoteBase {
    public config: Config
    public medias: Array<Media>
    public isCloze: boolean

    constructor(
        public blueprint: Blueprint,
        public id: number | null,
        public fields: NoteFields,
        public source: SourceDescriptor,
        public sourceText: string,
        {
            config,
            medias = [],
            isCloze = false,
        }: {
            config: Config
            medias?: Array<Media>
            isCloze?: boolean
        },
    ) {
        this.config = config
        this.medias = medias
        this.isCloze = isCloze
    }

    public renderAsText(): string {
        return this.blueprint.renderAsText(this)
    }

    public fieldsToAnkiFields(fields: NoteFields): AnkiFields {
        if (this.isCloze) {
            return {
                Text: fields[NoteField.Frontlike] || '',
                'Back Extra': fields[NoteField.Backlike] || '',
            }
        }

        return { Front: fields[NoteField.Frontlike] || '', Back: fields[NoteField.Backlike] || '' }
    }

    public normaliseNoteInfoFields(noteInfo: NotesInfoResponseEntity): NoteFields {
        const isCloze = noteInfo.modelName === 'Cloze'

        const frontlike = isCloze ? 'Text' : 'Front'
        const backlike = isCloze ? 'Back Extra' : 'Back'

        return {
            [NoteField.Frontlike]: noteInfo.fields[frontlike].value,
            [NoteField.Backlike]: noteInfo.fields[backlike].value,
        }
    }

    public shouldUpdateFile(): boolean {
        return this.getEnabled() && this.renderAsText() !== this.sourceText
    }

    public getModelName(): ModelName {
        if (this.isCloze) {
            return 'Cloze'
        }

        return 'Basic'
    }

    /**
     * Returns the resolved deck name
     */
    public getDeckName(plugin: AnkiBridgePlugin): string {
        // Use in-note configured deck
        if (plugin.settings.inheritDeck === false) {
            if (this.config.deck) {
                return this.config.deck
            }

            // Try to resolve based on default deck mappings
            const resolvedDefaultDeck = getDefaultDeckForFolder(
                this.source.file.parent,
                plugin.settings.defaultDeckMaps,
            )
            if (resolvedDefaultDeck) {
                return resolvedDefaultDeck
            }
        } else if (plugin.settings.inheritDeck === true) {
            // Mirror the folder structure
            var deckName = this.source.file.path
                .split('/')
                .join('::')
            var deckName = plugin.settings.fallbackDeck + '::' + deckName
            return deckName
        }
        // Fallback if no deck was found
        return plugin.settings.fallbackDeck
    }

    public getTags(plugin: AnkiBridgePlugin): Array<string> {
        if (plugin.settings.inheritTags === true) {
            const cache = plugin.app.metadataCache.getFileCache(this.source.file)
            if (cache && getAllTags(cache) !== null) {
                var tags = (getAllTags(cache)) as string[]
                // Strip out the hash symbol
                var tags = tags.map((tag) => tag.replace('#', ''))
                // Convert hierarchial tags to anki format
                var tags = tags.map((tag) => tag.replace(/\//g, '::'));
                var tags = tags?.concat(this.config.tags || [])
                // Filter out duplicates
                var tags = tags.filter((item, index) => tags.indexOf(item) === index)
                return [plugin.settings.tagInAnki, ...(tags || [])]
            } else {
                return [plugin.settings.tagInAnki, ...(this.config.tags || [])]
            }
        } else {
            return [plugin.settings.tagInAnki, ...(this.config.tags || [])]
        }
    }

    public getEnabled(): boolean {
        return this.config.enabled === undefined || this.config.enabled
    }
}

export interface NoteWithID extends NoteBase {
    id: number
}

export function hasID(note: NoteBase | NoteWithID): note is NoteWithID {
    return note.id !== null
}
