"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import { Network } from "lucide-react";
import type {
  CustomNodeElementProps,
  RawNodeDatum,
} from "react-d3-tree";

import { Avatar } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";
import {
  getOrgChart,
  queryKeys,
  type OrgTreeNodeApi,
} from "@/lib/api/queries";

// react-d3-tree pulls window APIs at import time; load on the client only.
const Tree = dynamic(
  () => import("react-d3-tree").then((m) => m.Tree ?? m.default),
  { ssr: false },
);

interface ExtendedRawNode extends RawNodeDatum {
  attributes?: {
    position?: string;
    department?: string;
  };
  children?: ExtendedRawNode[];
}

function toRawNode(node: OrgTreeNodeApi): ExtendedRawNode {
  return {
    name: node.name,
    attributes: {
      ...(node.position ? { position: node.position } : {}),
      ...(node.department ? { department: node.department } : {}),
    },
    children: node.children.map(toRawNode),
  };
}

function wrapAsSingleRoot(roots: OrgTreeNodeApi[]): ExtendedRawNode {
  if (roots.length === 1 && roots[0]) {
    return toRawNode(roots[0]);
  }
  return {
    name: "Vaudit",
    attributes: { department: "Organisation" },
    children: roots.map(toRawNode),
  };
}

function NodeCard({
  nodeDatum,
  toggleNode,
}: CustomNodeElementProps): React.JSX.Element {
  const name = nodeDatum.name;
  const attrs = (nodeDatum.attributes ?? {}) as Record<string, string | number | boolean>;
  const position = typeof attrs["position"] === "string" ? attrs["position"] : "";
  const department =
    typeof attrs["department"] === "string" ? attrs["department"] : "";
  // SVG-rendered tree expects SVG returns; embed HTML via foreignObject.
  return (
    <g>
      <foreignObject x={-120} y={-44} width={240} height={88}>
        <button
          type="button"
          onClick={toggleNode}
          className="flex h-full w-full items-center gap-3 rounded-lg border border-border bg-card p-3 text-left shadow-sm transition-ui hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Toggle ${name}`}
        >
          <Avatar name={name} size="md" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">
              {name}
            </p>
            {position ? (
              <p className="truncate text-xs text-muted-foreground">{position}</p>
            ) : null}
            {department ? (
              <p className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
                {department}
              </p>
            ) : null}
          </div>
        </button>
      </foreignObject>
    </g>
  );
}

export function OrgChartClient(): React.JSX.Element {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [translate, setTranslate] = React.useState({ x: 200, y: 80 });

  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.orgChart(),
    queryFn: () => getOrgChart(),
  });

  React.useEffect(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setTranslate({ x: rect.width / 2, y: 80 });
  }, [data]);

  if (isLoading) {
    return (
      <div className="h-[60vh] w-full animate-pulse rounded-lg border border-border bg-muted/30" />
    );
  }

  if (isError || !data) {
    return (
      <EmptyState
        icon={<Network />}
        title="Couldn't load org chart"
        description="Try refreshing the page. If the issue persists, contact IT."
      />
    );
  }

  if (data.roots.length === 0) {
    return (
      <EmptyState
        icon={<Network />}
        title="No org chart yet"
        description="Add employees and managers to see the chart."
      />
    );
  }

  const rootDatum = wrapAsSingleRoot(data.roots);

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground sm:hidden">
        Tip: pinch to zoom, drag to pan.
      </p>
      <div
        ref={containerRef}
        className="relative h-[70vh] w-full overflow-hidden rounded-lg border border-border bg-card"
      >
        <Tree
          data={rootDatum}
          orientation="vertical"
          renderCustomNodeElement={NodeCard}
          translate={translate}
          collapsible
          zoomable
          draggable
          separation={{ siblings: 1.6, nonSiblings: 2 }}
          nodeSize={{ x: 260, y: 130 }}
          pathFunc="elbow"
          scaleExtent={{ min: 0.3, max: 2 }}
        />
      </div>
    </div>
  );
}
