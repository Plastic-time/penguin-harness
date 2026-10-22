/**
 * Which roadmaps each proposal belongs to, for the PR graph's segment headings. The graph comes
 * from company-proposals and the roadmaps from company-roadmaps, so the page joins them: every
 * roadmap's items name the proposals they were delegated to or adopted (roadmapRows), and a
 * proposal may sit on more than one roadmap. Read once per graph load; a roadmap that fails to
 * read only leaves its proposals unnamed.
 */
import { useEffect, useState } from "react";
import * as api from "../../api/endpoints";
import { roadmapRows } from "../company/roadmaps";
import { roadmapsBackoff, roadmapsKey } from "../company/roadmaps-backoff";
import type { RoadmapRef } from "./pr-graph-segments";

export function useProposalRoadmaps(
  projectId: string,
  orgId: string,
  /** Changes when the graph is read again, so the roadmaps are too. */
  round: unknown,
): ReadonlyMap<number, RoadmapRef[]> {
  const [byProposal, setByProposal] = useState<ReadonlyMap<number, RoadmapRef[]>>(new Map());
  useEffect(() => {
    let alive = true;
    // The graph's own reload brings `round` around again; whether this roadmap read may start
    // is the organization's shared roadmaps backoff's to say (roadmaps-backoff.ts) — a dead
    // link to the organization's machine names no proposals' roadmaps, and is not re-asked on
    // every reload while it is down. The failure's own retry fills the map when it returns.
    const gate = roadmapsKey(projectId, orgId);
    const read = async () => {
      // A surface that unmounted while the gate was shut leaves its retry behind in the
      // backoff's waiting set; running it must not send a read for a surface nobody is
      // looking at — one open of the gate, one read, not one per reload.
      if (!alive) return;
      const list = await api.listOrgRoadmaps(projectId, orgId).catch(() => null);
      if (list === null) {
        roadmapsBackoff.failed(gate, () => {
          if (alive) void read();
        });
        return;
      }
      roadmapsBackoff.answered(gate);
      const details = await Promise.all(
        list.roadmaps.map((r) => api.getOrgRoadmap(projectId, orgId, r.number).catch(() => null)),
      );
      const map = new Map<number, RoadmapRef[]>();
      for (const d of details) {
        if (d === null) continue;
        const ref: RoadmapRef = { number: d.number, name: d.name, channelId: d.channelId };
        for (const row of roadmapRows(d)) {
          if (row.proposal === null) continue;
          const refs = map.get(row.proposal) ?? [];
          if (!refs.some((x) => x.number === ref.number)) refs.push(ref);
          map.set(row.proposal, refs);
        }
      }
      if (alive) setByProposal(map);
    };
    if (roadmapsBackoff.mayStart(gate)) void read();
    else
      roadmapsBackoff.defer(gate, () => {
        if (alive) void read();
      });
    return () => {
      alive = false;
    };
  }, [projectId, orgId, round]);
  return byProposal;
}
