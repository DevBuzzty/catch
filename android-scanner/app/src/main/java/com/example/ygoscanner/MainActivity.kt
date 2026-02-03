package com.example.ygoscanner

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.ListView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.Camera
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import kotlin.concurrent.thread

class MainActivity : AppCompatActivity() {
    private lateinit var previewView: PreviewView
    private lateinit var statusText: TextView
    private lateinit var lastResultText: TextView
    private lateinit var serverInput: EditText
    private lateinit var connectButton: Button
    private lateinit var connectOverlay: FrameLayout
    private lateinit var connectionStatus: TextView
    private lateinit var scannerContainer: FrameLayout
    private lateinit var libraryContainer: android.widget.LinearLayout
    private lateinit var tabScanner: Button
    private lateinit var tabLibrary: Button
    private lateinit var libraryStatus: TextView
    private lateinit var libraryList: ListView
    private lateinit var scanButton: Button
    private lateinit var torchButton: Button

    private val cameraExecutor = Executors.newSingleThreadExecutor()
    private val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    private var webSocket: WebSocket? = null
    private var lastSentKey: String? = null
    private var lastAnalysisAt = 0L
    private var candidatePasscode: String? = null
    private var candidateHits = 0
    private val libraryItems = mutableListOf<CardRecord>()
    private lateinit var libraryAdapter: CardAdapter
    private var torchEnabled = false
    private var activeCamera: Camera? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        previewView = findViewById(R.id.previewView)
        statusText = findViewById(R.id.statusText)
        lastResultText = findViewById(R.id.lastResultText)
        serverInput = findViewById(R.id.serverInput)
        connectButton = findViewById(R.id.connectButton)
        connectOverlay = findViewById(R.id.connectOverlay)
        connectionStatus = findViewById(R.id.connectionStatus)
        scannerContainer = findViewById(R.id.scannerContainer)
        libraryContainer = findViewById(R.id.libraryContainer)
        tabScanner = findViewById(R.id.tabScanner)
        tabLibrary = findViewById(R.id.tabLibrary)
        libraryStatus = findViewById(R.id.libraryStatus)
        libraryList = findViewById(R.id.libraryList)
        scanButton = findViewById(R.id.scanButton)
        torchButton = findViewById(R.id.torchButton)

        libraryAdapter = CardAdapter(this, libraryItems)
        libraryList.adapter = libraryAdapter

        tabScanner.setOnClickListener { showScanner() }
        tabLibrary.setOnClickListener { showLibrary() }
        loadCachedLibrary()
        loadSavedServerAddress()

        connectButton.setOnClickListener {
            if (hasCameraPermission()) {
                connectAndStart()
            } else {
                ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.CAMERA), 1001)
            }
        }

        scanButton.setOnClickListener {
            statusText.text = "Status: Scannen…"
        }

        torchButton.setOnClickListener {
            torchEnabled = !torchEnabled
            torchButton.text = if (torchEnabled) "Licht an" else "Licht"
            activeCamera?.cameraControl?.enableTorch(torchEnabled)
        }
    }

    private fun connectAndStart() {
        val target = serverInput.text.toString().trim()
        if (target.isEmpty()) {
            statusText.text = "Status: Bitte PC IP:Port eingeben"
            return
        }
        val wsUrl = "ws://$target"
        saveServerAddress(target)
        val client = OkHttpClient()
        val request = Request.Builder().url(wsUrl).build()
        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: okhttp3.Response?) {
                statusText.post { statusText.text = "Status: Verbindung fehlgeschlagen" }
                connectionStatus.post { connectionStatus.text = "Connection failed" }
            }

            override fun onOpen(webSocket: WebSocket, response: okhttp3.Response) {
                connectionStatus.post { connectionStatus.text = "Connected" }
                connectOverlay.post { connectOverlay.visibility = android.view.View.GONE }
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                handleServerMessage(text)
            }
        })
        statusText.text = "Status: verbunden ($wsUrl)"
        connectionStatus.text = "Connecting..."
        requestSync()
        startCamera()
    }

    private fun startCamera() {
        val cameraProviderFuture = ProcessCameraProvider.getInstance(this)
        cameraProviderFuture.addListener({
            val cameraProvider = cameraProviderFuture.get()
            val preview = Preview.Builder().build().also {
                it.setSurfaceProvider(previewView.surfaceProvider)
            }
            val analysis = ImageAnalysis.Builder()
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .build()
                .also { imageAnalysis ->
                    imageAnalysis.setAnalyzer(cameraExecutor) { imageProxy ->
                        val now = System.currentTimeMillis()
                        if (now - lastAnalysisAt < 900) {
                            imageProxy.close()
                            return@setAnalyzer
                        }
                        lastAnalysisAt = now
                        val mediaImage = imageProxy.image
                        if (mediaImage != null) {
                            val image = InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)
                            recognizer.process(image)
                                .addOnSuccessListener { visionText ->
                                val passcode = extractPasscode(visionText, imageProxy.width, imageProxy.height)
                                if (passcode != null) {
                                    trackCandidate(passcode)?.let { confirmed ->
                                        sendCard(CardPayload(deName = "", enName = "", passcode = confirmed))
                                        statusText.post { statusText.text = "Status: Passcode erkannt ($confirmed)" }
                                    }
                                } else {
                                    statusText.post { statusText.text = "Status: Suche Passcode…" }
                                }
                                }
                                .addOnCompleteListener { imageProxy.close() }
                        } else {
                            imageProxy.close()
                        }
                    }
                }

            cameraProvider.unbindAll()
            activeCamera = cameraProvider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
        }, ContextCompat.getMainExecutor(this))
    }

    private fun extractPasscode(visionText: com.google.mlkit.vision.text.Text, width: Int, height: Int): String? {
        val regionTop = (height * 0.58f).toInt()
        val regionRight = (width * 0.6f).toInt()
        val regex = Regex("\\b\\d{8}\\b")

        visionText.textBlocks.forEach { block ->
            val box = block.boundingBox ?: return@forEach
            val inRegion = box.centerX() <= regionRight && box.centerY() >= regionTop
            val digits = regex.find(block.text)?.value
            if (digits != null && inRegion) {
                return digits
            }
        }

        visionText.textBlocks.forEach { block ->
            block.lines.forEach { line ->
                val box = line.boundingBox ?: return@forEach
                val inRegion = box.centerX() <= regionRight && box.centerY() >= regionTop
                if (!inRegion) return@forEach
                val lineDigits = regex.find(line.text)?.value
                if (lineDigits != null) return lineDigits
            }
        }
        return null
    }

    private fun trackCandidate(passcode: String): String? {
        if (passcode != candidatePasscode) {
            candidatePasscode = passcode
            candidateHits = 1
            return null
        }
        candidateHits += 1
        return if (candidateHits >= 2) {
            candidatePasscode = null
            candidateHits = 0
            passcode
        } else {
            null
        }
    }


    private fun sendCard(card: CardPayload) {
        val key = if (card.passcode.isNotBlank()) {
            card.passcode.trim().lowercase()
        } else {
            card.enName.trim().lowercase()
        }
        if (key.isBlank() || key == lastSentKey) {
            return
        }
        lastSentKey = key
        val obj = JSONObject()
        obj.put("type", "scan")
        obj.put("card", JSONObject().apply {
            put("de_name", card.deName)
            put("en_name", card.enName)
            put("passcode", card.passcode)
        })
        webSocket?.send(obj.toString())
    }

    private fun requestSync() {
        val obj = JSONObject()
        obj.put("type", "sync")
        webSocket?.send(obj.toString())
    }

    private fun handleServerMessage(text: String) {
        try {
            val payload = JSONObject(text)
            when (payload.optString("type")) {
                "scanResult" -> {
                    val card = payload.optJSONObject("card") ?: return
                    val deName = card.optString("de_name")
                    val enName = card.optString("en_name")
                    val passcode = card.optString("passcode")
                    lastResultText.post {
                        lastResultText.text = "Letzter Scan: $passcode\nDE: $deName\nEN: $enName"
                    }
                }
                "sync" -> {
                    val cards = payload.optJSONArray("cards") ?: JSONArray()
                    updateLibrary(cards)
                }
            }
        } catch (_: Exception) {
            // ignore
        }
    }

    private fun updateLibrary(cards: JSONArray) {
        libraryItems.clear()
        for (i in 0 until cards.length()) {
            val item = cards.optJSONObject(i) ?: continue
            libraryItems.add(
                CardRecord(
                    id = item.optInt("id"),
                    deName = item.optString("de_name"),
                    enName = item.optString("en_name"),
                    passcode = item.optString("passcode"),
                    imageUrl = item.optString("source_url")
                )
            )
        }
        cacheLibrary(cards)
        libraryStatus.post { libraryStatus.text = "Geladene Karten: ${libraryItems.size}" }
        runOnUiThread { libraryAdapter.notifyDataSetChanged() }
    }

    private fun cacheLibrary(cards: JSONArray) {
        val prefs = getSharedPreferences("scanner_cache", MODE_PRIVATE)
        prefs.edit().putString("cards", cards.toString()).apply()
    }

    private fun loadCachedLibrary() {
        val prefs = getSharedPreferences("scanner_cache", MODE_PRIVATE)
        val raw = prefs.getString("cards", null) ?: return
        try {
            val cards = JSONArray(raw)
            updateLibrary(cards)
        } catch (_: Exception) {
        }
    }

    private fun showScanner() {
        scannerContainer.visibility = android.view.View.VISIBLE
        libraryContainer.visibility = android.view.View.GONE
    }

    private fun showLibrary() {
        scannerContainer.visibility = android.view.View.GONE
        libraryContainer.visibility = android.view.View.VISIBLE
        requestSync()
    }

    private fun saveServerAddress(value: String) {
        val prefs = getSharedPreferences("scanner_cache", MODE_PRIVATE)
        prefs.edit().putString("server_address", value).apply()
    }

    private fun loadSavedServerAddress() {
        val prefs = getSharedPreferences("scanner_cache", MODE_PRIVATE)
        val saved = prefs.getString("server_address", "") ?: ""
        if (saved.isNotBlank()) {
            serverInput.setText(saved)
        }
    }

    private fun hasCameraPermission(): Boolean {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
    }
}

data class CardPayload(val deName: String, val enName: String, val passcode: String)

data class CardRecord(
    val id: Int,
    val deName: String,
    val enName: String,
    val passcode: String,
    val imageUrl: String
)

class CardAdapter(
    private val context: android.content.Context,
    private val items: List<CardRecord>
) : android.widget.BaseAdapter() {
    override fun getCount(): Int = items.size
    override fun getItem(position: Int): Any = items[position]
    override fun getItemId(position: Int): Long = items[position].id.toLong()

    override fun getView(position: Int, convertView: android.view.View?, parent: android.view.ViewGroup): android.view.View {
        val view = convertView ?: android.view.LayoutInflater.from(context).inflate(R.layout.item_card, parent, false)
        val record = items[position]
        val title = view.findViewById<TextView>(R.id.cardTitle)
        val subtitle = view.findViewById<TextView>(R.id.cardSubtitle)
        val passcode = view.findViewById<TextView>(R.id.cardPasscode)
        val image = view.findViewById<ImageView>(R.id.cardImage)

        title.text = record.enName.ifBlank { record.deName }
        subtitle.text = "DE: ${record.deName} / EN: ${record.enName}"
        passcode.text = "Passcode: ${record.passcode}"
        if (record.imageUrl.isNotBlank()) {
            loadImage(record.imageUrl, image)
        }
        return view
    }

    private fun loadImage(url: String, imageView: ImageView) {
        thread {
            try {
                val connection = URL(url).openConnection() as HttpURLConnection
                connection.connectTimeout = 5000
                connection.readTimeout = 5000
                connection.doInput = true
                connection.connect()
                val bitmap = android.graphics.BitmapFactory.decodeStream(connection.inputStream)
                imageView.post { imageView.setImageBitmap(bitmap) }
            } catch (_: Exception) {
            }
        }
    }
}
