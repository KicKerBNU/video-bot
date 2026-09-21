import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { AppModule } from './app.module';
import { AppConfigService } from './config/app-config.service';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(AppConfigService);

  app.enableCors({
    origin: [
      'http://127.0.0.1:5173',
      'http://localhost:5173',
      'http://127.0.0.1:3000',
      'http://localhost:3000',
    ],
    credentials: true,
  });

  const voiceUi = join(process.cwd(), 'web/voice-pack/dist');
  if (existsSync(join(voiceUi, 'index.html'))) {
    app.useStaticAssets(voiceUi, { prefix: '/voice' });
    const indexHtml = readFileSync(join(voiceUi, 'index.html'), 'utf8');
    const httpAdapter = app.getHttpAdapter().getInstance() as {
      get: (path: string, handler: (req: unknown, res: { type: (t: string) => { send: (b: string) => void } }) => void) => void;
    };
    httpAdapter.get('/voice', (_req, res) => {
      res.type('html').send(indexHtml);
    });
    httpAdapter.get('/voice/', (_req, res) => {
      res.type('html').send(indexHtml);
    });
  }

  await app.listen(config.port);
  // eslint-disable-next-line no-console
  console.log(`video-gen listening on http://localhost:${config.port}`);
  if (existsSync(join(voiceUi, 'index.html'))) {
    // eslint-disable-next-line no-console
    console.log(`voice pack UI → http://localhost:${config.port}/voice/`);
  }
}

void bootstrap();
