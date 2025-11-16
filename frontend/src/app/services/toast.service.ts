import { Injectable, signal } from '@angular/core';

export type ToastType = 'success' | 'info' | 'warning' | 'error';
export interface Toast { id: string; message: string; type: ToastType; }

@Injectable({ providedIn: 'root' })
export class ToastService {
  toasts = signal<Toast[]>([]);

  show(message: string, type: ToastType = 'info', duration = 4000) {
    const id = `${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;
    const toast: Toast = { id, message, type };
    this.toasts.set([...this.toasts(), toast]);
    if (duration > 0) setTimeout(() => this.dismiss(id), duration);
  }

  success(message: string) { this.show(message, 'success'); }
  info(message: string) { this.show(message, 'info'); }
  warning(message: string) { this.show(message, 'warning'); }
  error(message: string) { this.show(message, 'error'); }

  dismiss(id: string) { this.toasts.set(this.toasts().filter(t => t.id !== id)); }
}

