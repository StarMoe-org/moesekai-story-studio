import React, { useMemo } from "react";
import {
    Button,
    Dialog,
    Icon,
} from "@moesekai/story-editor/md3";
import { mdOpenInNew } from "@moesekai/story-editor/md3/icons";
import type { DesktopUiLocale } from "../../shared/ipc";
import { formatDesktopMessage } from "../i18n/desktopMessages";
import { StudioLogo } from "./StudioLogo";

export interface AboutNoticesDialogProps {
    open: boolean;
    locale: DesktopUiLocale;
    currentVersion: string;
    onOpenExternal: (url: string) => void;
    onClose: () => void;
}

const COMMUNITY_LINKS = [
    {
        id: "website",
        labelKey: "aboutLinkWebsite" as const,
        sublabel: "pjsk.moe",
        url: "https://pjsk.moe",
    },
    {
        id: "bilibili",
        labelKey: "aboutLinkBilibili" as const,
        sublabel: "space.bilibili.com/5441521",
        url: "https://space.bilibili.com/5441521",
    },
    {
        id: "discord",
        labelKey: "aboutLinkDiscord" as const,
        sublabel: "discord.gg/6JQMVQ2Mku",
        url: "https://discord.gg/6JQMVQ2Mku",
    },
    {
        id: "qq",
        labelKey: "aboutLinkQqGroup" as const,
        sublabel: "1130135677",
        url: "https://qm.qq.com/cgi-bin/qm/qr?k=iUZhVFvgHRyknINbLwZXeM5jKZS_25na&jump_from=webapi&authKey=O80SsyvpH0k8Y8TU2sCFqZNgqZ4CsuBu6t9fBIuxwW1xi1Upd7NVI029a8tZgwZE",
    },
] as const;

export const AboutNoticesDialog: React.FC<AboutNoticesDialogProps> = ({
    open,
    locale,
    currentVersion,
    onOpenExternal,
    onClose,
}) => {
    const t = (key: Parameters<typeof formatDesktopMessage>[1], vars?: Record<string, string | number>) =>
        formatDesktopMessage(locale, key, vars);

    const normalizedCurrent = currentVersion.replace(/^v/i, "") || "0.1.2";

    const noticeSections = useMemo(
        () => [
            { id: "attribution", title: t("noticeAttributionTitle"), body: t("noticeAttributionBody") },
            { id: "ip", title: t("noticeIpTitle"), body: t("noticeIpBody") },
            { id: "license", title: t("noticeLicenseTitle"), body: t("noticeLicenseBody") },
            { id: "privacy", title: t("noticePrivacyTitle"), body: t("noticePrivacyBody") },
            { id: "disclaimer", title: t("noticeDisclaimerTitle"), body: t("noticeDisclaimerBody") },
        ],
        [locale],
    );

    return (
        <Dialog
            isOpen={open}
            onClose={onClose}
            title={t("aboutDialogTitle")}
            size="md"
            className="max-w-[560px]"
            showClose
            syncHistory={false}
            actions={
                <div className="flex w-full flex-wrap items-center justify-between gap-2">
                    <Button
                        variant="outlined"
                        size="s"
                        icon={mdOpenInNew}
                        onClick={() => onOpenExternal("https://pjsk.moe")}
                    >
                        {t("aboutOpenWebsite")}
                    </Button>
                    <Button variant="filled" size="s" onClick={onClose}>
                        {t("close")}
                    </Button>
                </div>
            }
        >
            <div data-testid="about-notices-dialog" className="flex flex-col gap-3 py-0.5">
                {/* Brand Identity Card */}
                <div className="flex items-center justify-between gap-3 rounded-md3-lg border border-outline-variant/75 bg-surface-container-low px-3.5 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                        <StudioLogo size={38} className="shrink-0" />
                        <div className="flex min-w-0 flex-col">
                            <div className="flex items-center gap-2">
                                <span className="type-title-s truncate font-semibold text-on-surface">
                                    {t("appName")}
                                </span>
                                <span className="shrink-0 rounded-md3-full bg-surface-container-highest px-2 py-0.5 font-mono type-label-s text-on-surface">
                                    v{normalizedCurrent}
                                </span>
                            </div>
                            <span className="type-label-s truncate text-on-surface-variant">
                                {t("aboutSubtitle")}
                            </span>
                        </div>
                    </div>
                    <span className="hidden shrink-0 rounded-md3-full bg-secondary-container px-2.5 py-0.5 type-label-s font-medium text-on-secondary-container sm:inline-flex">
                        {t("aboutLicenseBadge")}
                    </span>
                </div>

                {/* Official MoeSekai Community Links (2x2 clean grid) */}
                <div
                    data-testid="about-community-links"
                    aria-label={t("aboutCommunityLabel")}
                    className="grid grid-cols-2 gap-2"
                >
                    {COMMUNITY_LINKS.map(link => (
                        <button
                            key={link.id}
                            type="button"
                            data-testid={`about-link-${link.id}`}
                            onClick={() => onOpenExternal(link.url)}
                            className="state-layer focus-ring flex min-w-0 cursor-pointer items-center justify-between gap-2 rounded-md3-md border border-outline-variant/75 bg-surface-container-low px-3 py-2 text-left transition-colors hover:border-primary/45 hover:bg-surface-container"
                        >
                            <div className="flex min-w-0 flex-col">
                                <span className="type-label-m truncate font-medium text-on-surface">
                                    {t(link.labelKey)}
                                </span>
                                <span className="type-label-s truncate font-mono text-on-surface-variant">
                                    {link.sublabel}
                                </span>
                            </div>
                            <Icon
                                path={mdOpenInNew}
                                size={15}
                                className="shrink-0 text-on-surface-variant"
                            />
                        </button>
                    ))}
                </div>

                {/* Concise Attribution, Copyright, Open-Source & Legal Notices */}
                <div
                    data-testid="notices-list"
                    className="flex max-h-[290px] flex-col gap-2 overflow-y-auto pr-0.5"
                >
                    {noticeSections.map(section => (
                        <section
                            key={section.id}
                            className="flex flex-col gap-1 rounded-md3-lg border border-outline-variant/70 bg-surface-container-low p-3"
                        >
                            <h3 className="type-label-l font-semibold text-on-surface">
                                {section.title}
                            </h3>
                            <p className="type-body-s leading-relaxed text-on-surface-variant">
                                {section.body}
                            </p>
                        </section>
                    ))}
                </div>
            </div>
        </Dialog>
    );
};
