"use client";

import * as React from "react";
import {
  flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel,
  getSortedRowModel, useReactTable,
  type ColumnDef, type ColumnFiltersState, type Header, type Row,
  type SortingState, type Table as TanstackTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

type DataTableProps<TData> = {
  columns: ReadonlyArray<ColumnDef<TData, unknown>>;
  data: ReadonlyArray<TData>;
  /** Enable column sorting (default: true) */
  sorting?: boolean;
  /** Enable a single global filter input. Pass false to disable. */
  filtering?: boolean | { placeholder?: string };
  /** Enable client-side pagination (default: true, 10 rows/page) */
  pagination?: boolean | { pageSize?: number };
  /** Render a card under sm breakpoint instead of the table row */
  mobileRender?: (row: TData) => React.ReactNode;
  /** Optional empty state slot. Renders inside the table body when 0 rows. */
  emptyState?: React.ReactNode;
  className?: string;
};

const DEFAULT_PAGE_SIZE = 10;

function SortIndicator({ dir }: { dir: false | "asc" | "desc" }): React.JSX.Element {
  if (dir === "asc") return <ArrowUp className="h-3.5 w-3.5" aria-hidden />;
  if (dir === "desc") return <ArrowDown className="h-3.5 w-3.5" aria-hidden />;
  return <ArrowUpDown className="h-3.5 w-3.5 opacity-50" aria-hidden />;
}

function HeaderCell<T>({ header, sortable }: { header: Header<T, unknown>; sortable: boolean }): React.JSX.Element {
  if (header.isPlaceholder) return <TableHead key={header.id} />;
  const canSort = sortable && header.column.getCanSort();
  const content = flexRender(header.column.columnDef.header, header.getContext());
  return (
    <TableHead className="select-none">
      {canSort ? (
        <button
          type="button"
          onClick={header.column.getToggleSortingHandler()}
          className="inline-flex items-center gap-1 text-left font-medium transition-ui hover:text-foreground"
        >
          {content}
          <SortIndicator dir={header.column.getIsSorted()} />
        </button>
      ) : (
        content
      )}
    </TableHead>
  );
}

function PaginationBar<T>({ table }: { table: TanstackTable<T> }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
      <span>Page {table.getState().pagination.pageIndex + 1} of {Math.max(table.getPageCount(), 1)}</span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} aria-label="Previous page" className="transition-ui">
          <ChevronLeft className="h-4 w-4" aria-hidden />Prev
        </Button>
        <Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} aria-label="Next page" className="transition-ui">
          Next<ChevronRight className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}

function MobileList<T>({ rows, render, emptyState }: { rows: ReadonlyArray<Row<T>>; render: (row: T) => React.ReactNode; emptyState: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3 sm:hidden">
      {rows.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">{emptyState}</div>
      ) : (
        rows.map((row) => <div key={row.id}>{render(row.original)}</div>)
      )}
    </div>
  );
}

export function DataTable<TData>({
  columns, data, sorting = true, filtering = true, pagination = true,
  mobileRender, emptyState, className,
}: DataTableProps<TData>): React.JSX.Element {
  const [sortingState, setSortingState] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = React.useState("");

  const pageSize = typeof pagination === "object" && pagination.pageSize ? pagination.pageSize : DEFAULT_PAGE_SIZE;

  const table = useReactTable({
    data: data as TData[],
    columns: columns as ColumnDef<TData, unknown>[],
    state: { ...(sorting ? { sorting: sortingState } : {}), columnFilters, globalFilter },
    onSortingChange: setSortingState,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    ...(sorting ? { getSortedRowModel: getSortedRowModel() } : {}),
    ...(filtering ? { getFilteredRowModel: getFilteredRowModel() } : {}),
    ...(pagination ? { getPaginationRowModel: getPaginationRowModel(), initialState: { pagination: { pageSize } } } : {}),
  });

  const placeholder = typeof filtering === "object" && filtering.placeholder ? filtering.placeholder : "Filter…";
  const rows = table.getRowModel().rows;
  const empty = emptyState ?? "No results";

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {filtering ? (
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder={placeholder}
            className="h-10 pl-9 transition-ui"
            aria-label="Filter rows"
          />
        </div>
      ) : null}

      {mobileRender ? <MobileList rows={rows} render={mobileRender} emptyState={empty} /> : null}

      <div className={cn("relative overflow-hidden rounded-lg border border-border bg-card", mobileRender && "hidden sm:block")}>
        <div className="max-h-[70vh] overflow-auto">
          <Table className="table-sticky-head">
            <TableHeader>
              {table.getHeaderGroups().map((group) => (
                <TableRow key={group.id} className="hover:bg-transparent">
                  {group.headers.map((header) => (
                    <HeaderCell key={header.id} header={header} sortable={sorting} />
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length} className="h-32 text-center text-muted-foreground">{empty}</TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id} {...(row.getIsSelected() ? { "data-state": "selected" as const } : {})}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {pagination && rows.length > 0 ? <PaginationBar table={table} /> : null}
    </div>
  );
}
