import type { EventBus } from '../events/eventBus';
import type { Store } from '../repositories/types';
import { AdminService } from '../services/admin.service';
import { AuthService } from '../services/auth.service';
import { BookingService } from '../services/booking.service';
import { CatalogService } from '../services/catalog.service';
import type { Deps } from '../services/context';
import { BoardService, NotificationService } from '../services/notification.service';
import { QueueService } from '../services/queue.service';
import { ReceptionService } from '../services/reception.service';
import type { Clock } from '../shared/util';

export interface Services {
  store: Store;
  clock: Clock;
  events: EventBus;
  auth: AuthService;
  catalog: CatalogService;
  booking: BookingService;
  reception: ReceptionService;
  queue: QueueService;
  admin: AdminService;
  notifications: NotificationService;
  board: BoardService;
}

export function buildServices(d: Deps): Services {
  return {
    store: d.store,
    clock: d.clock,
    events: d.events,
    auth: new AuthService(d),
    catalog: new CatalogService(d),
    booking: new BookingService(d),
    reception: new ReceptionService(d),
    queue: new QueueService(d),
    admin: new AdminService(d),
    notifications: new NotificationService(d),
    board: new BoardService(d),
  };
}
