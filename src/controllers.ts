import { Body, Controller, Get, Header, HttpCode, HttpException, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { validText } from './jobs';
import { page } from './page';
import { RateLimit } from './zoo';
import { ZooService } from './zoo.service';

const enqueueLimit = new RateLimit(30, 60000);

@Controller('_zoo')
export class ZooController {
  constructor(private readonly zoo: ZooService) {}

  @Get('health')
  @Header('Cache-Control', 'no-store')
  health() {
    return this.zoo.health();
  }

  @Get('probe')
  @Header('Cache-Control', 'no-store')
  async probe(@Res({ passthrough: true }) res: Response) {
    try {
      const { status, body } = await this.zoo.probe();
      res.status(status);
      return body;
    } catch (err) {
      res.status(500);
      return { error: err instanceof Error ? err.message : 'probe failed' };
    }
  }
}

@Controller()
export class JobsController {
  constructor(private readonly zoo: ZooService) {}

  private async enqueue(input: unknown): Promise<string> {
    const text = validText(input);
    if (!text) throw new HttpException({ error: 'text must be 1 to 200 printable characters' }, 400);
    if (!enqueueLimit.allow()) throw new HttpException({ error: 'too many jobs, try again in a minute' }, 429);
    return this.zoo.enqueue(text);
  }

  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  async index() {
    try {
      const [counts, rows] = await Promise.all([this.zoo.counts(), this.zoo.recent()]);
      return page(counts, rows);
    } catch (err) {
      return page({}, [], `Queue or database unavailable: ${err instanceof Error ? err.message : err}`);
    }
  }

  @Post('jobs')
  async form(@Body() body: { text?: unknown }, @Res() res: Response) {
    await this.enqueue(body?.text);
    res.redirect(303, '/');
  }

  @Get('api/queue')
  async queue() {
    const [counts, recent] = await Promise.all([this.zoo.counts(), this.zoo.recent()]);
    return { queue: 'zoo-jobs', counts, recent };
  }

  @Post('api/jobs')
  @HttpCode(202)
  async create(@Body() body: { text?: unknown }) {
    return { id: await this.enqueue(body?.text), queued: true };
  }
}
