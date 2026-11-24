import { useEffect, useSyncExternalStore } from "react";
import { storyAgentDesk, type StoryAgentConfig, type StoryAgentDesk, type StoryAgentDeskState } from "./storyAgentDesk";
import type { StoryAgentTarget } from "./target";

/** The desk for `target`'s story, attached to `target` while the calling component is mounted. */
export function useStoryAgentDesk(
    target: StoryAgentTarget,
    config: StoryAgentConfig,
): readonly [StoryAgentDeskState, StoryAgentDesk] {
    const desk = storyAgentDesk(target.storyKey);
    useEffect(() => desk.attach(target), [desk, target]);
    useEffect(() => desk.configure(config), [desk, config]);
    const state = useSyncExternalStore(desk.subscribe, desk.getState, desk.getState);
    return [state, desk];
}
