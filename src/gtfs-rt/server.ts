import express from 'express';
import { GtfsRtConverter } from './converter';

const app = express();
const converter = new GtfsRtConverter();

app.get('/gtfs-rt/trip-updates', async (req, res) => {
  try {
    const feed = await converter.generateFeed(STOP_IDS);
    res.set('Content-Type', 'application/x-protobuf');
    res.send(Buffer.from(feed));
  } catch (error) {
    console.error('Error generating GTFS-RT feed:', error);
    res.status(500).send('Error generating feed');
  }
});

const PORT = process.env.PORT || 80;
app.listen(PORT, () => {
  console.log(`GTFS-RT server running on port ${PORT}`);
});