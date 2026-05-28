import { Download, Filter, RotateCcw, SlidersHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import type { Filters } from "../../lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";

type Props = {
  filters: Filters;
  onChange: (filters: Filters) => void;
  onApply: () => void;
  onImportFiltered: () => void;
  onReset: () => void;
  busy?: boolean;
};

export default function FiltersPanel({ filters, onChange, onApply, onImportFiltered, onReset, busy }: Props) {
  const update = (key: keyof Filters, value: string | boolean) => {
    onChange({ ...filters, [key]: value });
  };

  return (
    <Card>
      <CardHeader className="pb-0">
        <div className="flex items-center gap-2">
          <SlidersHorizontal size={18} className="text-primary" />
          <CardTitle>Filters</CardTitle>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <Field label="Date from">
          <Input type="date" value={filters.dateFrom || ""} onChange={(event) => update("dateFrom", event.target.value)} />
        </Field>
        <Field label="Date to">
          <Input type="date" value={filters.dateTo || ""} onChange={(event) => update("dateTo", event.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Min mag">
            <Input min="0" step="0.1" type="number" value={filters.minMagnitude || ""} onChange={(event) => update("minMagnitude", event.target.value)} />
          </Field>
          <Field label="Max mag">
            <Input min="0" step="0.1" type="number" value={filters.maxMagnitude || ""} onChange={(event) => update("maxMagnitude", event.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Min depth">
            <Input step="1" type="number" value={filters.minDepth || ""} onChange={(event) => update("minDepth", event.target.value)} />
          </Field>
          <Field label="Max depth">
            <Input step="1" type="number" value={filters.maxDepth || ""} onChange={(event) => update("maxDepth", event.target.value)} />
          </Field>
        </div>
        <Field label="Alert">
          <Select value={filters.alert || "all"} onValueChange={(value) => update("alert", value === "all" ? "" : value ?? "")}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="start">
              <SelectItem value="all">All alerts</SelectItem>
              <SelectItem value="green">Green</SelectItem>
              <SelectItem value="yellow">Yellow</SelectItem>
              <SelectItem value="orange">Orange</SelectItem>
              <SelectItem value="red">Red</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Limit">
          <Select value={filters.limit || "1000"} onValueChange={(value) => update("limit", value ?? "1000")}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="start">
              <SelectItem value="500">500</SelectItem>
              <SelectItem value="1000">1,000</SelectItem>
              <SelectItem value="2500">2,500</SelectItem>
              <SelectItem value="5000">5,000</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Separator />

        <ToggleRow id="tsunami-only-switch" label="Tsunami only">
          <Switch
            id="tsunami-only-switch"
            aria-labelledby="tsunami-only-switch-label"
            checked={Boolean(filters.tsunamiOnly)}
            onCheckedChange={(checked) => update("tsunamiOnly", Boolean(checked))}
          />
        </ToggleRow>

        <div className="grid grid-cols-2 gap-2 pt-2">
          <Button type="button" disabled={busy} onClick={onApply}>
            <Filter size={16} />
            Apply
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={onReset}>
            <RotateCcw size={16} />
            Reset
          </Button>
        </div>
        <Button className="w-full" type="button" variant="secondary" disabled={busy} onClick={onImportFiltered}>
          <Download size={16} />
          Load Filter Data
        </Button>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Label className="block space-y-1.5 text-sm">
      <span className="block text-muted-foreground">{label}</span>
      {children}
    </Label>
  );
}

function ToggleRow({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <Label
      htmlFor={id}
      className="flex cursor-pointer items-center justify-between rounded-lg border bg-muted/30 px-3 py-2"
    >
      <span id={`${id}-label`} className="text-sm font-medium text-foreground">{label}</span>
      {children}
    </Label>
  );
}
