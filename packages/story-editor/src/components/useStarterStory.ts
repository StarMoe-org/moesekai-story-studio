"use client";
import { useCallback } from "react";
import { useStoryI18n as useI18n } from "../context/StoryStudioContext";
import { createStarterStoryFromScript, type StarterLocale } from "@moesekai/story-core";
import type { StoryDocument, StoryRegion } from "@moesekai/story-core";

function toStarterLocale(locale: string): StarterLocale {
    if (locale === "zh-CN" || locale === "zh-TW" || locale.startsWith("zh")) return "zh";
    if (locale === "ja-JP" || locale.startsWith("ja")) return "ja";
    return "en";
}

/** Builds a localized `moesekai-story/2` starter demo graph parsed from a `.msk` script. */
export function useStarterStory() {
    const { locale } = useI18n();
    return useCallback((region: StoryRegion): StoryDocument => (
        createStarterStoryFromScript(region, toStarterLocale(locale))
    ), [locale]);
}
