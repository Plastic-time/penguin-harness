/**
 * Home: the slogan hero with the app live under it, A2APP (an agent growing its own apps),
 * observable self-evolution, the cost comparison, customer scenarios, the latest posts, how to
 * install, and the close.
 */
import { Hero } from "../sections/hero";
import { A2app } from "../sections/a2app";
import { Evolve } from "../sections/evolve";
import { Benchmark } from "../sections/benchmark";
import { Scenarios } from "../sections/scenarios";
import { Updates } from "../sections/updates";
import { Quickstart } from "../sections/quickstart";
import { Cta } from "../sections/cta";
import { Community } from "../sections/community";

export function HomePage() {
  return (
    <>
      <Hero />
      <A2app />
      <Evolve />
      <Benchmark />
      <Scenarios />
      <Updates />
      <Quickstart />
      <Cta />
      <Community />
    </>
  );
}
