const express = require('express');
const mediasoup = require('mediasoup');

const app = express();
app.use(express.json());
app.use(express.static('public'));

let worker, router, producerTransport, producer;

(async () => {
  worker = await mediasoup.createWorker({
    logLevel: 'warn',
    rtcMinPort: 10000,
    rtcMaxPort: 10100,
  });

  router = await worker.createRouter({
    mediaCodecs: [
      {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2,
      },
    ],
  });

  console.log('Mediasoup сервер запущен');
})();

app.get('/getRouterRtpCapabilities', async (req, res) => {
  res.json(router.rtpCapabilities);
});

app.post('/createTransport', async (req, res) => {
  const transport = await router.createWebRtcTransport({
    listenIps: [{ ip: '0.0.0.0' }],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
  });

  if (req.body.sender) {
    producerTransport = transport;
  }

  res.json({
    id: transport.id,
    iceParameters: transport.iceParameters,
    iceCandidates: transport.iceCandidates,
    dtlsParameters: transport.dtlsParameters,
  });
});

app.post('/transport-connect', async (req, res) => {
  await producerTransport.connect(req.body.dtlsParameters);
  res.json({ connected: true });
});

app.post('/transport-produce', async (req, res) => {
  producer = await producerTransport.produce({
    kind: req.body.kind,
    rtpParameters: req.body.rtpParameters,
  });

  res.json({ id: producer.id });
});

app.post('/consume', async (req, res) => {
  if (!producer) return res.status(400).json({ error: 'no producer yet' });

  const transport = await router.createWebRtcTransport({
    listenIps: [{ ip: '0.0.0.0' }],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
  });

  const consumer = await transport.consume({
    producerId: producer.id,
    rtpCapabilities: req.body.rtpCapabilities,
    paused: false,
  });

  res.json({
    id: transport.id,
    producerId: producer.id,
    consumerId: consumer.id,
    kind: consumer.kind,
    rtpParameters: consumer.rtpParameters,
    iceParameters: transport.iceParameters,
    iceCandidates: transport.iceCandidates,
    dtlsParameters: transport.dtlsParameters,
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Сервер работает: https://localhost:${PORT}`));
