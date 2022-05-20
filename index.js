const express = require("express");
const cors = require("cors");
const app = express();
const jwt = require("jsonwebtoken");
require("dotenv").config();
const mandrillTransport = require("nodemailer-mandrill-transport");
const nodemailer = require("nodemailer");

const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Hello From Doctors Portal");
});

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const res = require("express/lib/response");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.q1cmm.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send({ message: "Unauthorized Access" });
  } else {
    const accessToken = authHeader.split(" ")[1];
    jwt.verify(
      accessToken,
      process.env.ACCESS_TOKEN_SECRET,
      (error, decoded) => {
        if (error) {
          return res.status(403).send({ message: "Forbidden" });
        } else {
          req.decoded = decoded;
          next();
        }
      }
    );
  }
}

const emailSenderOptions = {
  auth: {
    apiKey: process.env.EMAIL_SENDER_KEY,
  }
};
const transport = nodemailer.createTransport(
  mandrillTransport(emailSenderOptions)
);

function sendAppointmentEmail(booking) {
  const { patientName, patient, treatment, slot, date } = booking;
  const emailTemplate = {
    from: process.env.EMAIL_SENDER,
    to: patient,
    subject: `Your Appointment For ${treatment} is on ${date} at ${slot} s confirmed`,
    text: `Your Appointment For ${treatment} is on ${date} at ${slot} s confirmed`,
    html: `
      <div>
        <h1>Hello ${patientName},</h1>
        <h3>Your Appointment for ${treatment} is confirmed.</h3>
        <p>Thank You for taking appointment from us. Our Doctors are good. So you dont have to worry about treatment. Our ${treatment} service is better than other hospitals ${treatment} service.</p>
        <p>Looking Forward To Seeing You on ${date}</p>
        <h4>Our Address</h4>
        <p>DSCC 158/24, North Rayerbag, Jatrabari, Dhaka.</p>
        <a href="https://mailchimp.com/help/about-domain-purchasing/">Unsubscribe</a>
      </div>
    `,
  };
  transport.sendMail(emailTemplate, function(err, info) {
    if (err) {
      console.error(err);
    } else {
      console.log('Message sent', info);
    }
  });
}

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
    const userCollection = client.db("doctors_portal").collection("users");
    const doctorCollection = client.db("doctors_portal").collection("doctors");

    const verifyAdmin = async (req, res, next) => {
      const requester = req.decoded.email;
      const requesterAccount = await userCollection.findOne({
        email: requester,
      });
      if (requesterAccount.role === "admin") {
        next();
      } else {
        res.status(403).send({ message: "Forbidden" });
      }
    };

    // API naming convention
    app.get("/service", async (req, res) => {
      const cursor = serviceCollection.find({}).project({ name: 1 });
      const services = await cursor.toArray();
      res.send(services);
    });

    app.get("/user", verifyJWT, async (req, res) => {
      const user = await userCollection.find({}).toArray();
      res.send(user);
    });
    app.get("/admin/:email", async (req, res) => {
      const email = req.params.email;
      const user = await userCollection.findOne({ email: email });
      const isAdmin = user.role === "admin";
      res.send({ admin: isAdmin });
    });
    app.put("/user/admin/:email", verifyJWT, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const filter = { email: email };
      const updatedDoc = {
        $set: { role: "admin" },
      };
      const result = await userCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });

    app.put("/user/:email", async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const filter = { email: email };
      const options = { upsert: true };
      const updatedDoc = {
        $set: user,
      };
      const result = await userCollection.updateOne(
        filter,
        updatedDoc,
        options
      );
      const token = jwt.sign(
        { email: email },
        process.env.ACCESS_TOKEN_SECRET,
        {
          expiresIn: "1h",
        }
      );
      res.send({ result, token });
    });

    app.get("/booking", verifyJWT, async (req, res) => {
      const patient = req.query.patient;
      const decodedEmail = req.decoded.email;
      if (patient === decodedEmail) {
        const bookings = await bookingCollection
          .find({ patient: patient })
          .toArray();
        res.send(bookings);
      } else {
        return res.status(403).send("Forbidden Access");
      }
    });
    app.post("/booking", async (req, res) => {
      const booking = req.body;
      const query = {
        treatment: booking.treatment,
        date: booking.date,
        patient: booking.patient,
      };
      const exists = await bookingCollection.findOne(query);
      if (exists) {
        return res.send({ success: false, booking: exists });
      }
      const result = await bookingCollection.insertOne(booking);
      sendAppointmentEmail(booking);
      res.send({ success: true, result });
    });
    // warning
    // This is not the proper way to query
    // After learning more about mongodb. Use aggregate lookup, pipeline, match, group
    app.get("/available", async (req, res) => {
      const date = req.query.date || "May 14, 2022";
      // 1. get all services
      const services = await serviceCollection.find({}).toArray();
      // get the bookings of that day
      const query = { date: date };
      const bookings = await bookingCollection.find(query).toArray();
      // 3. For each service, find booking for that service
      services.forEach((service) => {
        const serviceBookings = bookings.filter(
          (b) => b.treatment === service.name
        );
        const bookedSlots = serviceBookings.map((book) => book.slot);
        const available = service.slots.filter((s) => !bookedSlots.includes(s));
        service.slots = available;
      });
      res.send(services);
    });
    app.get("/doctor", verifyJWT, verifyAdmin, async (req, res) => {
      const doctors = await doctorCollection.find({}).toArray();
      res.send(doctors);
    });
    app.post("/doctor", verifyJWT, verifyAdmin, async (req, res) => {
      const doctor = req.body;
      const result = await doctorCollection.insertOne(doctor);
      res.send(result);
    });
    app.delete("/doctor/:email", verifyJWT, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const result = await doctorCollection.deleteOne({ email: email });
      res.send(result);
    });
  } finally {
    // await client.close()
  }
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`Doctors Portal Is Running on port ${port}`);
});
