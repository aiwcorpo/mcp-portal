import { Pipe, PipeTransform } from '@angular/core';
import { neutraliseText } from './untrusted-text';

/** Text from an IGA, a server or the registry: hidden characters become visible markers before it is shown. */
@Pipe({ name: 'safeText' })
export class SafeTextPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    return value ? neutraliseText(value).text : '';
  }
}
