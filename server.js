const express = require('express');
const mediasoup = require('mediasoup');
const app = express();

app.use(express.json());
app.use(express.static('public'));

let worker, router;
const transports = new Map(); // Храним все транспорты
const producers = new Map(); // Храним всех продюсеров
const consumers = new Map(); // Храним всех консьюмеров

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
  
  console.log('Mediasoup запущен');
})();

const getAnnouncedIp = () => {
  if (process.env.RENDER_EXTERNAL_HOSTNAME) {
    return process.env.RENDER_EXTERNAL_HOSTNAME;
  }
  return undefined;
};

app.get('/getRouterRtpCapabilities', (req, res) => {
  res.json(router.rtpCapabilities);
});

app.post('/createTransport', async (req, res) => {
  try {
    const transport = await router.createWebRtcTransport({
      listenInfos: [
        { 
          protocol: 'udp', 
          ip: '0.0.0.0',
          announcedIp: getAnnouncedIp()
        },
        { 
          protocol: 'tcp', 
          ip: '0.0.0.0',
          announcedIp: getAnnouncedIp()
        },
      ],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
    });

    transports.set(transport.id, transport);

    res.json({
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    });
  } catch (error) {
    console.error('Ошибка создания транспорта:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/transport-connect', async (req, res) => {
  try {
    const { transportId, dtlsParameters } = req.body;
    const transport = transports.get(transportId);
    
    if (!transport) {
      return res.status(404).json({ error: 'Transport not found' });
    }

    await transport.connect({ dtlsParameters });
    res.json({ ok: true });
  } catch (error) {
    console.error('Ошибка подключения транспорта:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/transport-produce', async (req, res) => {
  try {
    const { transportId, kind, rtpParameters } = req.body;
    const transport = transports.get(transportId);
    
    if (!transport) {
      return res.status(404).json({ error: 'Transport not found' });
    }

    const producer = await transport.produce({ kind, rtpParameters });
    producers.set(producer.id, producer);
    
    console.log('Новый продюсер создан:', producer.id);
    res.json({ id: producer.id });
  } catch (error) {
    console.error('Ошибка создания продюсера:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/consume', async (req, res) => {
  try {
    const { rtpCapabilities, consumerTransportId } = req.body;
    
    // Получаем всех активных продюсеров
    const activeProducers = Array.from(producers.values());
    
    if (activeProducers.length === 0) {
      return res.status(503).json({ error: 'no producers yet' });
    }

    const consumersData = [];

    for (const producer of activeProducers) {
      // Проверяем, может ли клиент консьюмить этого продюсера
      if (!router.canConsume({ producerId: producer.id, rtpCapabilities })) {
        continue;
      }

      // Используем существующий транспорт или создаем новый
      let consumerTransport = transports.get(consumerTransportId);
      
      if (!consumerTransport) {
        consumerTransport = await router.createWebRtcTransport({
          listenInfos: [
            { 
              protocol: 'udp', 
              ip: '0.0.0.0',
              announcedIp: getAnnouncedIp()
            },
            { 
              protocol: 'tcp', 
              ip: '0.0.0.0',
              announcedIp: getAnnouncedIp()
            },
          ],
          enableUdp: true,
          enableTcp: true,
          preferUdp: true,
        });
        
        transports.set(consumerTransport.id, consumerTransport);
      }

      const consumer = await consumerTransport.consume({
        producerId: producer.id,
        rtpCapabilities,
        paused: false,
      });

      consumers.set(consumer.id, consumer);

      consumersData.push({
        transportId: consumerTransport.id,
        producerId: producer.id,
        consumerId: consumer.id,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
        iceParameters: consumerTransport.iceParameters,
        iceCandidates: consumerTransport.iceCandidates,
        dtlsParameters: consumerTransport.dtlsParameters,
      });
    }

    res.json(consumersData);
  } catch (error) {
    console.error('Ошибка создания консьюмера:', error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
