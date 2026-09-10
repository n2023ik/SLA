import { queryOptions } from "@tanstack/react-query";

import { getOpsSnapshot, getOrderDetail, listInterventions } from "./ops.functions";

export const snapshotQuery = (days: number) =>
  queryOptions({
    queryKey: ["ops-snapshot", days],
    queryFn: () => getOpsSnapshot({ data: { days } }),
    staleTime: 30_000,
  });

export const orderDetailQuery = (orderId: string) =>
  queryOptions({
    queryKey: ["order-detail", orderId],
    queryFn: () => getOrderDetail({ data: { orderId } }),
    staleTime: 30_000,
  });

export const interventionsQuery = () =>
  queryOptions({
    queryKey: ["interventions"],
    queryFn: () => listInterventions(),
    staleTime: 30_000,
    retry: false,
  });
