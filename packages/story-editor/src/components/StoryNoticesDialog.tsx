"use client";
import { Button, Dialog, Icon, Surface, useMd3I18n } from "../md3";
import { mdCloudDone, mdDescription, mdInfo, mdVerified } from "../md3/icons";

export interface StoryNoticesDialogProps {
    isOpen: boolean;
    onClose: () => void;
}

/**
 * Lightweight built-in MD3 Attribution & Legal Notices dialog rendered automatically by
 * `<StoryStudioProvider>` when the host does not supply a custom `onOpenNotices` handler.
 */
export function StoryNoticesDialog({ isOpen, onClose }: StoryNoticesDialogProps) {
    const { t } = useMd3I18n();

    const sections = [
        {
            key: "service",
            icon: mdCloudDone,
            title: t("page.storyMaker.attribution.serviceTitle"),
            body: t("page.storyMaker.attribution.serviceBody"),
        },
        {
            key: "ip",
            icon: mdInfo,
            title: t("page.storyMaker.attribution.ipTitle"),
            body: t("page.storyMaker.attribution.ipBody"),
        },
        {
            key: "license",
            icon: mdVerified,
            title: t("page.storyMaker.attribution.licenseTitle"),
            body: t("page.storyMaker.attribution.licenseBody"),
        },
        {
            key: "content",
            icon: mdDescription,
            title: t("page.storyMaker.attribution.contentTitle"),
            body: t("page.storyMaker.attribution.contentBody"),
        },
    ] as const;

    return (
        <Dialog
            isOpen={isOpen}
            onClose={onClose}
            title={t("page.storyMaker.attribution.dialogTitle")}
            supportingText={t("page.storyMaker.attribution.dialogSubtitle")}
            size="md"
            actions={(
                <Button variant="filled" onClick={onClose}>
                    {t("common.action.close")}
                </Button>
            )}
        >
            <div className="space-y-2.5">
                {sections.map((section) => (
                    <Surface
                        key={section.key}
                        tone="low"
                        radius="lg"
                        className="border border-outline-variant/55 p-3.5"
                    >
                        <div className="flex items-start gap-2.5">
                            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md3-sm bg-secondary-container text-on-secondary-container">
                                <Icon path={section.icon} size={16} />
                            </span>
                            <div className="min-w-0 flex-1 space-y-1">
                                <p className="type-title-s text-on-surface">{section.title}</p>
                                <p className="type-body-s leading-relaxed text-on-surface-variant">
                                    {section.body}
                                </p>
                            </div>
                        </div>
                    </Surface>
                ))}
            </div>
        </Dialog>
    );
}
