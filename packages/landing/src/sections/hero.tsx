/**
 * The home page's opening, centered: the PenguinHarness lockup over the slogan, the subtitle, two
 * direct installation paths, the providers' logos ending in a link to MMSP's model index, and
 * then the app itself, live: the start page in a frame. The logos and the index link leave the
 * site, so they confirm before they open; which providers are drawn, and where each links, is
 * lib/rsi-stats.ts.
 */
import { Link } from "react-router";
import { useSiteLocale } from "@prismshadow/penguin-ui/site";
import { S } from "../lib/strings";
import { RELEASE_VERSION } from "../lib/version";
import { mmspModelsUrl } from "../lib/links";
import { MODEL_PROVIDERS } from "../lib/rsi-stats";
import { DownloadIcon, ModelProviderLogo, TerminalIcon } from "../components/icons";
import { ExternalLink, ExternalLinkScope } from "../components/external-link";
import { LiveAppFrame } from "../components/live-app-frame";

export function Hero() {
  const { locale } = useSiteLocale();
  // Chinese clauses carry their own full-width punctuation and join without a space; English
  // sentences need one between them.
  const clauseGap = locale === "zh" ? "" : " ";

  return (
    <section className="relative overflow-hidden">
      <div className="hero-dots pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="relative mx-auto max-w-6xl px-4 pt-12 pb-12 text-center sm:px-6 sm:pt-20 sm:pb-14">
        <p className="anim-rise flex items-center justify-center gap-3">
          <img src={`${import.meta.env.BASE_URL}penguin-logo.svg`} alt="" className="h-10 w-10" />
          <span className="text-xl font-semibold tracking-tight sm:text-2xl">{S.siteName}</span>
        </p>

        {/* Each clause is an inline block, so a line that cannot hold both breaks between them
            first: on a phone the second clause always starts a line of its own. */}
        <h1
          className="anim-rise mt-7 text-[clamp(2.125rem,5vw,3.75rem)] leading-[1.18] font-semibold tracking-tight text-balance break-keep [overflow-wrap:break-word]"
          style={{ animationDelay: "60ms" }}
        >
          {S.hero.slogan.map((clause, i) => (
            <span key={clause}>
              {i > 0 && clauseGap}
              <span className="inline-block">{clause}</span>
            </span>
          ))}
        </h1>
        <p
          className="anim-rise mt-5 text-lg text-balance text-gray-600 sm:text-xl dark:text-gray-300"
          style={{ animationDelay: "120ms" }}
        >
          {S.hero.subtitle}
        </p>

        <div
          className="anim-rise mt-8 flex flex-wrap items-center justify-center gap-3"
          style={{ animationDelay: "180ms" }}
        >
          <Link
            to="/download"
            className="inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-gray-900 px-5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
          >
            <DownloadIcon className="h-4 w-4" />
            <span>{S.hero.downloadCta}</span>
            <span className="border-l border-white/25 pl-2 text-xs font-medium text-white/70 tabular-nums dark:border-gray-900/20 dark:text-gray-900/60">
              {RELEASE_VERSION}
            </span>
          </Link>
          <Link
            to="/#quickstart-install"
            className="inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-gray-200 bg-white px-5 text-sm font-semibold text-gray-900 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
          >
            <TerminalIcon className="h-4 w-4" />
            {S.hero.cliInstall}
          </Link>
        </div>

        <ExternalLinkScope>
          <ul
            className="anim-rise mt-10 flex flex-wrap items-center justify-center gap-x-2 gap-y-2"
            style={{ animationDelay: "240ms" }}
          >
            {MODEL_PROVIDERS.map((provider) => (
              <li key={provider.id}>
                <ExternalLink
                  href={provider.href}
                  aria-label={provider.name}
                  title={provider.name}
                  className="inline-flex rounded-md p-1 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  <ModelProviderLogo provider={provider.id} className="h-7 w-7" />
                </ExternalLink>
              </li>
            ))}
            {/* On a phone the link wraps under the logos, centered; the margin only applies
                while it shares their line. */}
            <li className="sm:ml-2">
              <ExternalLink
                href={mmspModelsUrl(locale)}
                className="text-sm font-medium whitespace-nowrap text-gray-500 tabular-nums underline decoration-gray-300 underline-offset-4 transition-colors hover:text-gray-900 hover:decoration-gray-500 dark:text-gray-400 dark:decoration-gray-600 dark:hover:text-gray-100 dark:hover:decoration-gray-400"
              >
                {S.hero.modelsMore}
              </ExternalLink>
            </li>
          </ul>
        </ExternalLinkScope>

        <LiveAppFrame
          surface="chat-new"
          title={S.hero.startFrame}
          className="anim-rise mx-auto mt-14 max-w-6xl text-left sm:mt-16"
        />
      </div>
    </section>
  );
}
