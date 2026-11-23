"use client";
import React, { createContext, useContext, useMemo } from "react";
import { createStudioTranslator, type StudioTranslateFn } from "../messages";

export interface StudioLinkProps extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
    href: string;
    prefetch?: boolean;
    ref?: React.Ref<HTMLAnchorElement>;
}

export type StudioLinkComponent = React.ComponentType<StudioLinkProps>;

export function DefaultStudioLink({ prefetch: _prefetch, ref, ...rest }: StudioLinkProps) {
    return <a ref={ref} {...rest} />;
}

export interface Md3ContextValue {
    t: StudioTranslateFn;
    LinkComponent: StudioLinkComponent;
    pathname?: string;
}

const defaultTranslator = createStudioTranslator("zh-CN");

const Md3Context = createContext<Md3ContextValue>({
    t: defaultTranslator,
    LinkComponent: DefaultStudioLink,
    pathname: undefined,
});

export function Md3Provider({
    t,
    LinkComponent,
    pathname,
    children,
}: Partial<Md3ContextValue> & { children: React.ReactNode }) {
    const parent = useContext(Md3Context);
    const resolvedT = t ?? parent.t;
    const resolvedLink = LinkComponent ?? parent.LinkComponent;
    const resolvedPathname = pathname !== undefined ? pathname : parent.pathname;
    const value = useMemo<Md3ContextValue>(
        () => ({
            t: resolvedT,
            LinkComponent: resolvedLink,
            pathname: resolvedPathname,
        }),
        [resolvedLink, resolvedPathname, resolvedT],
    );
    return <Md3Context.Provider value={value}>{children}</Md3Context.Provider>;
}

export function useMd3Context(): Md3ContextValue {
    return useContext(Md3Context);
}

export function useMd3I18n(): { t: StudioTranslateFn } {
    const { t } = useContext(Md3Context);
    return { t };
}

export function StudioLink(props: StudioLinkProps) {
    const { LinkComponent } = useContext(Md3Context);
    return <LinkComponent {...props} />;
}
