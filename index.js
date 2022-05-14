const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Hello From Doctors Portal");
});

const { MongoClient, ServerApiVersion } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.q1cmm.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

async function run() {
  try {
    await client.connect();
    console.log("Database Connected");
    const serviceCollection = client
      .db("doctors_portal")
      .collection("services");
    const bookingCollection = client
      .db("doctors_portal")
      .collection("bookings");

    // API naming convention
    app.get("/service", async (req, res) => {
      const cursor = serviceCollection.find({});
      const services = await cursor.toArray();
      res.send(services);
    });

    app.get('/booking', async (req, res) => {
      const patient = req.query.patient;
      const bookings = await bookingCollection.find({patient: patient}).toArray();
      res.send(bookings); 
    })
    app.post('/booking', async(req, res) => {
      const booking = req.body;
      const query = {treatment: booking.treatment, date: booking.date, patient: booking.patient}
      const exists = await bookingCollection.findOne(query);
      if(exists) {
        return res.send({success: false, booking: exists})
      }
      const result = await bookingCollection.insertOne(booking);
      res.send({success: true, result});
    })
    // warning
    // This is not the proper way to query
    // After learning more about mongodb. Use aggregate lookup, pipeline, match, group
    app.get('/available', async(req, res) => {
      const date = req.query.date || 'May 14, 2022';
      // 1. get all services
      const services = await serviceCollection.find({}).toArray();
      // get the bookings of that day
      const query = {date: date};
      const bookings = await bookingCollection.find(query).toArray();
      // 3. For each service, find booking for that service
      services.forEach(service => {
        const serviceBookings = bookings.filter(b => b.treatment === service.name);
        const bookedSlots = serviceBookings.map(book => book.slot);
        const available = service.slots.filter(s => !bookedSlots.includes(s));
        service.slots = available;
      })
      res.send(services);
    })
  } finally {
    // await client.close()
  }
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`Doctors Portal Is Running on port ${port}`);
});
