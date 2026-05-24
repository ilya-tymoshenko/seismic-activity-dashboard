import type { Earthquake } from "../../lib/types";
import { formatDateTime, formatNumber } from "../../lib/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Props = {
  earthquakes: Earthquake[];
};

export default function EarthquakeTable({ earthquakes }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent earthquakes</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="max-h-[420px] overflow-auto rounded-lg border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Mag</TableHead>
                <TableHead>Depth</TableHead>
                <TableHead>Place</TableHead>
                <TableHead>Tsunami</TableHead>
                <TableHead>Alert</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
            {earthquakes.slice(0, 80).map((earthquake) => (
              <TableRow key={earthquake.id}>
                <TableCell className="text-muted-foreground">{formatDateTime(earthquake.time)}</TableCell>
                <TableCell className="font-semibold text-foreground">{formatNumber(earthquake.magnitude, 1)}</TableCell>
                <TableCell className="text-muted-foreground">{formatNumber(earthquake.depth, 1)} km</TableCell>
                <TableCell className="min-w-[260px] whitespace-normal text-foreground">{earthquake.place || "Unknown"}</TableCell>
                <TableCell>
                  <Badge variant={earthquake.tsunami === 1 ? "destructive" : "secondary"}>
                    {earthquake.tsunami === 1 ? "Yes" : "No"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{earthquake.alert || "n/a"}</Badge>
                </TableCell>
              </TableRow>
            ))}
            {earthquakes.length === 0 && (
              <TableRow>
                <TableCell className="px-4 py-8 text-center text-muted-foreground" colSpan={6}>No events for current filters.</TableCell>
              </TableRow>
            )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
